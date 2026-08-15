import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { supabase, STORAGE_BUCKET } from './supabase'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export function chapterFolder(seriesId, chapterNumber) {
  const safeNumber = String(chapterNumber).replace(/[^a-zA-Z0-9._-]/g, '_')
  return `series_${seriesId}/chapter_${safeNumber}`
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not create a WebP image.')), 'image/webp', 0.86)
  })
}

export async function processPdfAndUpload(file, { seriesId, chapterNumber, onProgress = () => {} }) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const folder = chapterFolder(seriesId, chapterNumber)

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    const blob = await canvasBlob(canvas)
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(`${folder}/${pageNumber}.webp`, blob, { contentType: 'image/webp', upsert: true })
    if (error) throw error
    onProgress(`Uploading page ${pageNumber} of ${pdf.numPages}...`)
    page.cleanup()
    canvas.width = 1
    canvas.height = 1
  }

  return { pageCount: pdf.numPages }
}
