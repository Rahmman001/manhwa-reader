import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Home,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { processPdfAndUpload, chapterFolder } from './pdfProcessor'
import { getPublicUrl, isSupabaseConfigured, supabase, STORAGE_BUCKET } from './supabase'

const demoSeries = [
  { id: 'demo-1', title: 'Demo Series', cover_image_url: '', description: 'Connect Supabase to replace this demo card with your own library.' },
]

async function fetchSeries() {
  if (!supabase) return demoSeries
  const { data, error } = await supabase.from('series').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

async function fetchChapters(seriesId) {
  if (!supabase || seriesId.startsWith('demo-')) return []
  const { data, error } = await supabase.from('chapters').select('*').eq('series_id', seriesId).order('chapter_number', { ascending: true })
  if (error) throw error
  return data || []
}

async function removeStorageFolder(prefix) {
  if (!supabase) return
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list(prefix, { limit: 1000 })
  if (error) throw error
  for (const item of data || []) {
    const path = `${prefix}/${item.name}`
    if (item.id) {
      const result = await supabase.storage.from(STORAGE_BUCKET).remove([path])
      if (result.error) throw result.error
    } else {
      await removeStorageFolder(path)
    }
  }
}

function App() {
  const [view, setView] = useState('home')
  const [series, setSeries] = useState([])
  const [selectedSeries, setSelectedSeries] = useState(null)
  const [chapters, setChapters] = useState([])
  const [selectedChapter, setSelectedChapter] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [message, setMessage] = useState('')

  async function refreshSeries() {
    setLoading(true)
    try { setSeries(await fetchSeries()) } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  useEffect(() => { refreshSeries() }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true

    async function loadAdminStatus(userId) {
      const { data, error } = await supabase.from('admin_users').select('user_id').eq('user_id', userId).maybeSingle()
      if (!active) return
      if (error) { setIsAdmin(false); setMessage(error.message); return }
      setIsAdmin(Boolean(data))
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session?.user) loadAdminStatus(data.session.user.id)
    })

    const { data: auth } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setIsAdmin(false)
      if (nextSession?.user) setTimeout(() => loadAdminStatus(nextSession.user.id), 0)
    })

    return () => { active = false; auth.subscription.unsubscribe() }
  }, [])

  async function openSeries(item) {
    setLoading(true); setMessage('')
    try { setSelectedSeries(item); setChapters(await fetchChapters(item.id)); setView('series') } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  async function enterReader(chapter) {
    setSelectedChapter(chapter)
    setView('reader')
    try { await document.documentElement.requestFullscreen?.() } catch { /* Fullscreen is optional. */ }
  }

  async function leaveReader() {
    try { if (document.fullscreenElement) await document.exitFullscreen() } catch { /* Exiting fullscreen is optional. */ }
    setView('series')
  }

  function openAdmin() {
    setView(isAdmin ? 'admin' : 'auth')
  }

  async function signOut() {
    await supabase?.auth.signOut()
    setView('home')
  }

  async function deleteSeries(item) {
    if (!supabase || !isAdmin || !window.confirm(`Delete ${item.title} and all its chapters?`)) return
    setLoading(true); setMessage('')
    try {
      await removeStorageFolder(`series_${item.id}`)
      const { error } = await supabase.from('series').delete().eq('id', item.id)
      if (error) throw error
      setSeries((current) => current.filter((seriesItem) => seriesItem.id !== item.id))
      setSelectedSeries(null); setChapters([]); setView('home'); setMessage('Series deleted.')
    } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  async function deleteChapter(chapter) {
    if (!supabase || !isAdmin || !selectedSeries || !window.confirm(`Delete Chapter ${chapter.chapter_number}?`)) return
    setLoading(true); setMessage('')
    try {
      await removeStorageFolder(chapterFolder(selectedSeries.id, chapter.chapter_number))
      const { error } = await supabase.from('chapters').delete().eq('id', chapter.id)
      if (error) throw error
      setChapters((current) => current.filter((item) => item.id !== chapter.id)); setMessage('Chapter deleted.')
    } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  async function updateSeries(item, changes) {
    if (!supabase || !isAdmin) return false
    setLoading(true); setMessage('')
    try {
      let coverImageUrl = item.cover_image_url
      if (changes.cover) {
        const extension = changes.cover.name.split('.').pop() || 'jpg'
        const path = `series_${item.id}/cover.${extension}`
        const upload = await supabase.storage.from(STORAGE_BUCKET).upload(path, changes.cover, { upsert: true, contentType: changes.cover.type })
        if (upload.error) throw upload.error
        coverImageUrl = getPublicUrl(path)
      }
      const { data, error } = await supabase.from('series').update({ title: changes.title, description: changes.description, cover_image_url: coverImageUrl }).eq('id', item.id).select().single()
      if (error) throw error
      setSeries((current) => current.map((seriesItem) => seriesItem.id === item.id ? data : seriesItem))
      setSelectedSeries(data); setMessage('Series updated.'); return true
    } catch (error) { setMessage(error.message); return false } finally { setLoading(false) }
  }

  const filteredSeries = useMemo(() => series.filter((item) => item.title.toLowerCase().includes(search.toLowerCase())), [series, search])

  return (
    <div className="min-h-screen bg-[#141414] text-white">
      {view !== 'reader' && <Header view={view} setView={setView} search={search} setSearch={setSearch} session={session} isAdmin={isAdmin} openAdmin={openAdmin} signOut={signOut} />}
      <main className={view === 'reader' ? 'p-0' : 'mx-auto max-w-7xl px-5 pb-12 pt-8 md:px-10'}>
        {message && <div className="mb-5 rounded-lg border border-red-500/40 bg-red-950/50 p-4 text-sm text-red-200">{message}</div>}
        {!isSupabaseConfigured && view !== 'reader' && <div className="mb-6 rounded-lg border border-yellow-500/30 bg-yellow-950/30 p-4 text-sm text-yellow-100">Supabase is not configured. Add the Vite environment variables to load your library and upload chapters.</div>}
        {loading && <div className="flex min-h-40 items-center justify-center"><LoaderCircle className="animate-spin text-[#E50914]" /></div>}
        {!loading && view === 'home' && <HomeView series={filteredSeries} openSeries={openSeries} openAdmin={openAdmin} />}
        {!loading && view === 'series' && <SeriesView series={selectedSeries} chapters={chapters} back={() => setView('home')} openReader={enterReader} isAdmin={isAdmin} deleteSeries={deleteSeries} deleteChapter={deleteChapter} updateSeries={updateSeries} />}
        {view === 'reader' && selectedSeries && selectedChapter && <ReaderView series={selectedSeries} chapter={selectedChapter} chapters={chapters} back={leaveReader} openReader={enterReader} />}
        {!loading && view === 'auth' && <AuthView back={() => setView('home')} onAuthenticated={() => setView('home')} />}
        {!loading && view === 'admin' && isAdmin && <AdminView series={series} refreshSeries={refreshSeries} back={() => setView('home')} setMessage={setMessage} />}
      </main>
    </div>
  )
}

function Header({ view, setView, search, setSearch, session, isAdmin, openAdmin, signOut }) {
  return <header className="sticky top-0 z-20 border-b border-white/10 bg-[#141414]/95 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center gap-5 px-5 py-4 md:px-10"><button className="flex items-center gap-2 text-lg font-bold" onClick={() => setView('home')}><BookOpen className="text-[#E50914]" /> <span>MANHWA</span></button><nav className="hidden items-center gap-5 text-sm text-gray-400 md:flex"><button className={view === 'home' ? 'text-white' : ''} onClick={() => setView('home')}><Home className="mr-1 inline h-4 w-4" />Browse</button><button className={view === 'admin' ? 'text-white' : ''} onClick={openAdmin}>{isAdmin ? <><UploadCloud className="mr-1 inline h-4 w-4" />Admin</> : 'Sign in'}</button></nav><div className="ml-auto flex items-center gap-2"><div className="flex items-center gap-2 rounded-md border border-white/10 bg-[#232323] px-3 py-2"><Search className="h-4 w-4 text-gray-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" className="w-24 bg-transparent text-sm outline-none placeholder:text-gray-500 md:w-48" /></div>{session && <button onClick={signOut} className="text-xs text-gray-400 hover:text-white">Sign out</button>}</div></div></header>
}

function AuthView({ back, onAuthenticated }) {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault(); setBusy(true); setMessage('')
    try {
      const result = mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
      if (result.error) throw result.error
      if (mode === 'signup' && !result.data.session) setMessage('Account created. Check your email, then sign in.')
      else onAuthenticated()
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  return <section className="mx-auto max-w-md"><button onClick={back} className="mb-6 flex items-center gap-2 text-sm text-gray-400 hover:text-white"><ArrowLeft className="h-4 w-4" />Back to browse</button><div className="rounded-xl bg-[#232323] p-6"><h1 className="mb-2 text-3xl font-black">{mode === 'signin' ? 'Sign in' : 'Create account'}</h1><p className="mb-6 text-sm text-gray-400">Only the account added as an admin can upload files.</p><form onSubmit={submit} className="space-y-4"><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" autoComplete="email" className="field" /><input required minLength="6" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} className="field" /><button disabled={busy} className="primary-button w-full">{busy ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}</button></form>{message && <p className="mt-4 text-sm text-gray-300">{message}</p>}<button onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage('') }} className="mt-5 text-sm text-gray-400 hover:text-white">{mode === 'signin' ? 'Create a new account' : 'Already have an account? Sign in'}</button></div></section>
}

function HomeView({ series, openSeries, openAdmin }) {
  return <section><div className="relative mb-10 overflow-hidden rounded-xl bg-gradient-to-r from-[#3b0b0f] to-[#232323] p-8 md:p-14"><div className="relative z-10 max-w-xl"><p className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-[#E50914]">Personal library</p><h1 className="mb-4 text-4xl font-black md:text-6xl">Read your way.</h1><p className="mb-6 text-gray-300">Upload a chapter PDF, convert it in your browser, and read it as a smooth vertical webtoon.</p><button onClick={openAdmin} className="rounded-md bg-[#E50914] px-5 py-3 font-bold hover:bg-red-700">Upload a chapter</button></div></div><div className="mb-4 flex items-center justify-between"><h2 className="text-2xl font-bold">Your series</h2><span className="text-sm text-gray-500">{series.length} series</span></div>{series.length === 0 ? <EmptyState text="No series yet. Create one from Admin." /> : <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">{series.map((item) => <SeriesCard key={item.id} series={item} onClick={() => openSeries(item)} />)}</div>}</section>
}

function SeriesCard({ series, onClick }) { return <button className="group overflow-hidden rounded-lg bg-[#232323] text-left transition hover:-translate-y-1 hover:ring-2 hover:ring-[#E50914]" onClick={onClick}><Cover series={series} /><div className="p-3"><h3 className="truncate font-bold">{series.title}</h3><p className="mt-1 text-xs text-gray-500">Open series</p></div></button> }
function Cover({ series, className = '' }) { return series.cover_image_url ? <img src={series.cover_image_url} alt="" className={`aspect-[2/3] w-full object-cover ${className}`} /> : <div className={`flex aspect-[2/3] items-end bg-gradient-to-br from-[#5c1118] via-[#292929] to-[#111] p-4 ${className}`}><span className="text-2xl font-black">{series.title.slice(0, 1).toUpperCase()}</span></div> }

function SeriesView({ series, chapters, back, openReader, isAdmin, deleteSeries, deleteChapter, updateSeries }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(series.title)
  const [description, setDescription] = useState(series.description || '')
  const [cover, setCover] = useState(null)

  function startEditing() {
    setTitle(series.title); setDescription(series.description || ''); setCover(null); setEditing(true)
  }

  async function saveChanges(event) {
    event.preventDefault()
    if (await updateSeries(series, { title, description, cover })) { setEditing(false); setCover(null) }
  }

  return <section><button onClick={back} className="mb-6 flex items-center gap-2 text-sm text-gray-400 hover:text-white"><ArrowLeft className="h-4 w-4" />Back to browse</button><div className="grid gap-8 md:grid-cols-[220px_1fr]"><Cover series={series} className="rounded-lg" /><div><div className="flex items-start justify-between gap-4"><div><p className="mb-2 text-sm font-bold uppercase tracking-widest text-[#E50914]">Series</p><h1 className="mb-4 text-4xl font-black">{series.title}</h1></div>{isAdmin && <div className="flex gap-2"><button onClick={startEditing} className="rounded bg-[#303030] px-3 py-2 text-xs text-gray-200 hover:bg-[#3a3a3a]"><Pencil className="mr-1 inline h-3 w-3" />Edit</button><button onClick={() => deleteSeries(series)} className="rounded bg-red-950/60 px-3 py-2 text-xs text-red-200 hover:bg-red-900"><Trash2 className="mr-1 inline h-3 w-3" />Delete</button></div>}</div>{editing ? <form onSubmit={saveChanges} className="mb-8 space-y-3 rounded-lg bg-[#232323] p-4"><input required value={title} onChange={(event) => setTitle(event.target.value)} className="field" placeholder="Title" /><textarea value={description} onChange={(event) => setDescription(event.target.value)} className="field min-h-24" placeholder="Description" /><input type="file" accept="image/*" onChange={(event) => setCover(event.target.files?.[0] || null)} className="field file:mr-3 file:rounded file:border-0 file:bg-[#E50914] file:px-3 file:py-2 file:text-white" /><div className="flex gap-2"><button className="primary-button">Save changes</button><button type="button" onClick={() => setEditing(false)} className="rounded bg-[#303030] px-4 py-3 text-sm">Cancel</button></div></form> : <p className="mb-8 max-w-2xl text-gray-400">{series.description || 'No description yet.'}</p>}<h2 className="mb-3 text-xl font-bold">Chapters</h2>{chapters.length === 0 ? <EmptyState text="No chapters uploaded yet." /> : <div className="space-y-2">{chapters.map((chapter) => <div key={chapter.id} className="flex items-center gap-2"><button onClick={() => openReader(chapter)} className="flex min-w-0 flex-1 items-center justify-between rounded-lg bg-[#232323] px-4 py-4 text-left hover:bg-[#303030]"><span>Chapter {chapter.chapter_number}</span><span className="text-sm text-gray-500">{chapter.page_count} pages <ChevronRight className="ml-2 inline h-4 w-4" /></span></button>{isAdmin && <button onClick={() => deleteChapter(chapter)} aria-label={`Delete chapter ${chapter.chapter_number}`} className="rounded bg-red-950/60 p-3 text-red-200 hover:bg-red-900"><Trash2 className="h-4 w-4" /></button>}</div>)}</div>}</div></div></section>
}

function ReaderView({ series, chapter, chapters, back, openReader }) {
  const index = chapters.findIndex((item) => item.id === chapter.id)
  const previous = chapters[index - 1]
  const next = chapters[index + 1]
  const [width, setWidth] = useState('wide')
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    setCurrentPage(1)
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (visible) setCurrentPage(Number(visible.target.dataset.page))
    }, { rootMargin: '-20% 0px -60% 0px' })

    document.querySelectorAll('[data-reader-page]').forEach((page) => observer.observe(page))
    return () => observer.disconnect()
  }, [chapter.id, chapter.page_count])

  return <section className="min-h-screen bg-black"><div className="sticky top-0 z-10 border-b border-white/10 bg-[#181818]/95 px-4 py-3 backdrop-blur"><div className="flex items-center justify-between gap-3"><button onClick={back} className="flex items-center gap-2 text-sm text-gray-300 hover:text-white"><ArrowLeft className="h-4 w-4" />Exit reader</button><span className="truncate text-sm font-bold">{series.title} - Chapter {chapter.chapter_number}</span><select value={width} onChange={(event) => setWidth(event.target.value)} className="rounded bg-[#303030] px-2 py-1 text-xs"><option value="wide">Fit width</option><option value="fixed">800px</option><option value="full">100%</option></select></div></div><div className="pointer-events-none fixed bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-[#181818]/90 px-2 py-1 text-[10px] text-gray-400 shadow backdrop-blur">{currentPage}/{chapter.page_count}</div><div className={`mx-auto ${width === 'fixed' ? 'max-w-[800px]' : width === 'full' ? 'max-w-none' : 'max-w-4xl'}`}>{!isSupabaseConfigured && <div className="p-8 text-center text-gray-400">Configure Supabase to load chapter images.</div>}{isSupabaseConfigured && Array.from({ length: chapter.page_count }, (_, index) => index + 1).map((page) => <img id={`reader-page-${chapter.id}-${page}`} data-reader-page="true" data-page={page} key={page} loading="lazy" src={getPublicUrl(chapterPagePath(series.id, chapter.chapter_number, page))} alt={`Page ${page}`} className="block w-full" />)}</div><div className="mx-auto flex max-w-4xl justify-between gap-4 p-5"><button disabled={!previous} onClick={() => openReader(previous)} className="rounded bg-[#232323] px-4 py-3 text-sm disabled:opacity-30"><ChevronLeft className="mr-1 inline h-4 w-4" />Previous</button><button disabled={!next} onClick={() => openReader(next)} className="rounded bg-[#E50914] px-4 py-3 text-sm disabled:opacity-30">Next<ChevronRight className="ml-1 inline h-4 w-4" /></button></div></section>
}

function AdminView({ series, refreshSeries, back, setMessage }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [cover, setCover] = useState(null)
  const [seriesId, setSeriesId] = useState('')
  const [chapterFiles, setChapterFiles] = useState([])
  const [progress, setProgress] = useState('')
  const [busy, setBusy] = useState(false)
  const filesInput = useRef(null)
  const folderInput = useRef(null)

  async function createSeries(event) {
    event.preventDefault()
    if (!supabase) return setMessage('Configure Supabase before creating a series.')
    setBusy(true)
    try {
      const { data, error } = await supabase.from('series').insert({ title, description }).select().single()
      if (error) throw error
      if (cover) {
        const path = `series_${data.id}/cover.${cover.name.split('.').pop() || 'jpg'}`
        const upload = await supabase.storage.from(STORAGE_BUCKET).upload(path, cover, { upsert: true, contentType: cover.type })
        if (upload.error) throw upload.error
        const update = await supabase.from('series').update({ cover_image_url: getPublicUrl(path) }).eq('id', data.id)
        if (update.error) throw update.error
      }
      setTitle(''); setDescription(''); setCover(null); setMessage('Series created.'); await refreshSeries()
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  function selectChapterFiles(event) {
    const files = Array.from(event.target.files || [])
      .filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
      .map((file) => ({ file, chapterNumber: chapterNumberFromName(file.name) }))
      .sort((a, b) => (a.chapterNumber ?? Infinity) - (b.chapterNumber ?? Infinity) || a.file.name.localeCompare(b.file.name))
    setChapterFiles(files)
  }

  async function uploadChapterFile(file, number, label) {
    const result = await processPdfAndUpload(file, { seriesId, chapterNumber: number, onProgress: (text) => setProgress(`${label}: ${text}`) })
    const { error } = await supabase.from('chapters').upsert({ series_id: seriesId, chapter_number: number, page_count: result.pageCount }, { onConflict: 'series_id,chapter_number' })
    if (error) throw error
  }

  async function uploadChapters(event) {
    event.preventDefault()
    if (!supabase) return setMessage('Configure Supabase before uploading chapters.')
    if (!seriesId || !chapterFiles.length) return setMessage('Choose a series and one or more PDF files first.')
    if (chapterFiles.some((item) => item.chapterNumber === null)) return setMessage('Every PDF filename needs a chapter number, such as Chapter 1.pdf.')
    if (new Set(chapterFiles.map((item) => item.chapterNumber)).size !== chapterFiles.length) return setMessage('Two files have the same chapter number.')

    setBusy(true); setMessage('')
    let currentChapter = ''
    try {
      for (const [index, item] of chapterFiles.entries()) {
        const label = `Chapter ${item.chapterNumber} (${index + 1}/${chapterFiles.length})`
        currentChapter = label
        await uploadChapterFile(item.file, item.chapterNumber, label)
      }
      setChapterFiles([]); setProgress(`Uploaded ${chapterFiles.length} chapters.`)
    } catch (error) { const detail = `Stopped at ${currentChapter}: ${error.message}`; setMessage(detail); setProgress(detail) } finally { setBusy(false) }
  }

  return <section className="mx-auto max-w-3xl"><button onClick={back} className="mb-6 flex items-center gap-2 text-sm text-gray-400 hover:text-white"><ArrowLeft className="h-4 w-4" />Back to browse</button><h1 className="mb-8 text-4xl font-black">Admin</h1><div className="grid gap-6 md:grid-cols-2"><form onSubmit={createSeries} className="space-y-4 rounded-xl bg-[#232323] p-5"><h2 className="text-xl font-bold">New series</h2><input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" className="field" /><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" className="field min-h-28" /><input type="file" accept="image/*" onChange={(event) => setCover(event.target.files?.[0] || null)} className="field file:mr-3 file:rounded file:border-0 file:bg-[#E50914] file:px-3 file:py-2 file:text-white" /><button disabled={busy} className="primary-button"><Plus className="inline h-4 w-4" /> Create series</button></form><form onSubmit={uploadChapters} className="space-y-4 rounded-xl bg-[#232323] p-5"><h2 className="text-xl font-bold">Upload chapters</h2><select required value={seriesId} onChange={(event) => setSeriesId(event.target.value)} className="field"><option value="">Choose series</option>{series.filter((item) => !item.id.startsWith('demo-')).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><div className="flex gap-2"><button type="button" onClick={() => filesInput.current?.click()} className="flex-1 rounded bg-[#303030] px-3 py-2 text-sm hover:bg-[#3a3a3a]">Choose PDF files</button><button type="button" onClick={() => folderInput.current?.click()} className="flex-1 rounded bg-[#303030] px-3 py-2 text-sm hover:bg-[#3a3a3a]">Choose folder</button></div><input ref={filesInput} type="file" accept=".pdf,application/pdf" multiple onChange={selectChapterFiles} className="hidden" /><input ref={folderInput} type="file" accept=".pdf,application/pdf" multiple webkitdirectory="" directory="" onChange={selectChapterFiles} className="hidden" /><p className="text-xs text-gray-500">Choose one PDF, multiple PDFs, or a folder. Filenames need a chapter number, such as Chapter 1.pdf.</p>{chapterFiles.length > 0 && <div className="max-h-32 overflow-auto rounded bg-[#181818] p-3 text-xs text-gray-400">{chapterFiles.map((item) => <div key={`${item.file.name}-${item.file.lastModified}`}>{item.chapterNumber === null ? '?' : `Chapter ${item.chapterNumber}`} — {item.file.name}</div>)}</div>}<button disabled={busy} className="primary-button"><UploadCloud className="inline h-4 w-4" /> Upload {chapterFiles.length || ''} chapters</button>{progress && <p className="text-sm text-gray-400">{progress}</p>}</form></div></section>
}

function EmptyState({ text }) { return <div className="rounded-lg border border-dashed border-white/15 p-8 text-center text-gray-500">{text}</div> }
function chapterNumberFromName(name) {
  const baseName = name.replace(/\.pdf$/i, '')
  const match = baseName.match(/(?:chapter|ch|episode|ep)[^\d]*(\d+(?:\.\d+)?)/i) || baseName.match(/(?:^|[\s._-])(\d+(?:\.\d+)?)(?:$|[\s._-])/)
  return match ? Number(match[1]) : null
}
function chapterPagePath(seriesId, chapterNumber, page) { return `${chapterFolder(seriesId, chapterNumber)}/${page}.webp` }

export default App
