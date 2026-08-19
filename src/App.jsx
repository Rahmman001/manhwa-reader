import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  X,
} from 'lucide-react'
import { Key, MonitorPlay, SignOut, Trash, UserCircle, X as ProfileX } from '@phosphor-icons/react'
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
  const [selectedGenre, setSelectedGenre] = useState('')
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [message, setMessage] = useState('')
  const [lastRead, setLastRead] = useState(readLastRead)
  const [readerWidth, setReaderWidth] = useState(readReaderWidth)
  const [favorites, setFavorites] = useState(readFavorites(null))
  const [favoritesOnly, setFavoritesOnly] = useState(false)

  async function refreshSeries() {
    setLoading(true)
    try { setSeries(await fetchSeries()) } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  useEffect(() => { refreshSeries() }, [])

  useEffect(() => {
    if (!message) return undefined
    const timer = setTimeout(() => setMessage(''), 5000)
    return () => clearTimeout(timer)
  }, [message])

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

  useEffect(() => {
    setFavorites(readFavorites(session?.user?.id))
    setFavoritesOnly(false)
  }, [session?.user?.id])

  async function openSeries(item) {
    setLoading(true); setMessage('')
    try { setSelectedSeries(item); setChapters(await fetchChapters(item.id)); setView('series') } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  async function enterReader(chapter) {
    setSelectedChapter(chapter)
    setView('reader')
    const reading = { seriesId: selectedSeries?.id, seriesTitle: selectedSeries?.title, coverImageUrl: selectedSeries?.cover_image_url, chapterId: chapter.id, chapterNumber: chapter.chapter_number }
    saveLastRead(reading); setLastRead(reading)
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

  async function updateUsername(value) {
    if (!supabase || !session) throw new Error('Please sign in first.')
    const nextUsername = value.trim()
    if (nextUsername.length < 2 || nextUsername.length > 30) throw new Error('Username must be 2-30 characters.')
    const { data, error } = await supabase.auth.updateUser({ data: { ...session.user.user_metadata, username: nextUsername } })
    if (error) throw error
    setSession((current) => current ? { ...current, user: data.user } : current)
  }

  async function changePassword(value) {
    if (!supabase || !session) throw new Error('Please sign in first.')
    if (value.length < 6) throw new Error('Password must be at least 6 characters.')
    const { error } = await supabase.auth.updateUser({ password: value })
    if (error) throw error
  }

  function updateReaderWidth(value) {
    if (!['wide', 'fixed', 'full'].includes(value)) return
    saveReaderWidth(value); setReaderWidth(value)
  }

  function toggleFavorite(item) {
    const key = favoritesKey(session?.user?.id)
    setFavorites((current) => {
      const next = current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]
      saveFavorites(key, next)
      return next
    })
  }

  function clearFavorites() {
    saveFavorites(favoritesKey(session?.user?.id), [])
    setFavorites([]); setFavoritesOnly(false)
  }

  function clearReadingProgress() {
    clearSavedProgress(); setLastRead(null)
  }

  async function deleteAccount() {
    if (!supabase || !session || !window.confirm('Delete your account permanently? This cannot be undone.')) return
    const { error } = await supabase.functions.invoke('delete-account')
    if (error) throw error
    await supabase.auth.signOut()
    setSession(null); setIsAdmin(false); setView('home'); setMessage('Account deleted.')
  }

  async function continueReading() {
    if (!lastRead) return
    const item = series.find((seriesItem) => seriesItem.id === lastRead.seriesId)
    if (!item) return setLastRead(null)
    setLoading(true); setMessage('')
    try {
      const loadedChapters = await fetchChapters(item.id)
      const chapter = loadedChapters.find((chapterItem) => chapterItem.id === lastRead.chapterId) || loadedChapters.find((chapterItem) => Number(chapterItem.chapter_number) === Number(lastRead.chapterNumber))
      if (!chapter) throw new Error('The saved chapter is no longer available.')
      setSelectedSeries(item); setChapters(loadedChapters); setSelectedChapter(chapter); setView('reader')
      try { await document.documentElement.requestFullscreen?.() } catch { /* Fullscreen is optional. */ }
    } catch (error) { setMessage(error.message) } finally { setLoading(false) }
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

  const genres = useMemo(() => [...new Set(series.flatMap((item) => extractGenres(item.description || '')))].sort((a, b) => a.localeCompare(b)), [series])
  const filteredSeries = useMemo(() => series.filter((item) => {
    const query = search.trim().toLowerCase()
    const itemGenres = extractGenres(item.description || '')
    const searchableText = `${item.title} ${item.description || ''} ${itemGenres.join(' ')}`.toLowerCase()
    return (!query || searchableText.includes(query)) && (!selectedGenre || itemGenres.includes(selectedGenre)) && (!favoritesOnly || favorites.includes(item.id))
  }), [series, search, selectedGenre, favoritesOnly, favorites])

  return (
    <div className="min-h-screen bg-[#141414] text-white">
      {view !== 'reader' && <Header view={view} seriesTitle={selectedSeries?.title} setView={setView} search={search} setSearch={setSearch} session={session} isAdmin={isAdmin} openAdmin={openAdmin} signOut={signOut} updateUsername={updateUsername} changePassword={changePassword} readerWidth={readerWidth} updateReaderWidth={updateReaderWidth} clearReadingProgress={clearReadingProgress} clearFavorites={clearFavorites} favoritesCount={favorites.length} deleteAccount={deleteAccount} />}
      <main className={view === 'reader' ? 'p-0' : 'mx-auto w-full max-w-[1800px] px-4 pb-12 pt-8 sm:px-6 lg:px-10'}>
        {message && <div role="status" className="mb-5 flex items-center justify-between gap-4 rounded-lg border border-red-500/40 bg-red-950/50 p-4 text-sm text-red-200"><span>{message}</span><button onClick={() => setMessage('')} aria-label="Close notification" className="rounded p-1 text-lg leading-none text-red-200 hover:bg-red-900 hover:text-white"><X className="h-4 w-4" /></button></div>}
        {!isSupabaseConfigured && view !== 'reader' && <div className="mb-6 rounded-lg border border-yellow-500/30 bg-yellow-950/30 p-4 text-sm text-yellow-100">Supabase is not configured. Add the Vite environment variables to load your library and upload chapters.</div>}
        {loading && <div className="flex min-h-40 items-center justify-center"><LoaderCircle className="animate-spin text-[#E50914]" /></div>}
        {!loading && view === 'home' && <HomeView series={filteredSeries} openSeries={openSeries} openAdmin={openAdmin} genres={genres} selectedGenre={selectedGenre} setSelectedGenre={setSelectedGenre} favoritesOnly={favoritesOnly} setFavoritesOnly={setFavoritesOnly} favoritesCount={favorites.length} favorites={favorites} toggleFavorite={toggleFavorite} />}
        {!loading && view === 'series' && <SeriesView series={selectedSeries} chapters={chapters} back={() => setView('home')} openReader={enterReader} isAdmin={isAdmin} deleteSeries={deleteSeries} deleteChapter={deleteChapter} updateSeries={updateSeries} lastRead={lastRead} continueReading={continueReading} />}
        {view === 'reader' && selectedSeries && selectedChapter && <ReaderView series={selectedSeries} chapter={selectedChapter} chapters={chapters} back={leaveReader} openReader={enterReader} readerWidth={readerWidth} updateReaderWidth={updateReaderWidth} />}
        {!loading && view === 'auth' && <AuthView back={() => setView('home')} onAuthenticated={() => setView('home')} />}
        {!loading && view === 'admin' && isAdmin && <AdminView series={series} refreshSeries={refreshSeries} back={() => setView('home')} setMessage={setMessage} />}
      </main>
    </div>
  )
}

function Header({ view, seriesTitle, setView, search, setSearch, session, isAdmin, openAdmin, signOut, updateUsername, changePassword, readerWidth, updateReaderWidth, clearReadingProgress, clearFavorites, favoritesCount, deleteAccount }) {
  const navClass = (active) => `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition duration-200 active:scale-[0.98] ${active ? 'bg-white/[0.07] text-white' : 'text-gray-400 hover:bg-white/[0.04] hover:text-white'}`
  const username = session?.user?.user_metadata?.username || ''
  const menuProps = { username, email: session?.user?.email || '', updateUsername, changePassword, readerWidth, updateReaderWidth, clearReadingProgress, clearFavorites, favoritesCount, deleteAccount, signOut }
  return <header className="sticky top-0 z-20 border-b border-white/10 bg-[#141414]/95 shadow-[0_12px_30px_rgba(10,10,10,0.28)] backdrop-blur">
    <div className="border-b border-white/[0.06]">
      <div className="mx-auto flex h-16 w-full max-w-[1800px] items-center gap-3 px-4 sm:px-6 lg:px-10">
        <button aria-label="Go to browse" className="flex shrink-0 items-center gap-2.5 rounded-lg text-lg font-extrabold tracking-[0.12em] transition hover:opacity-90 active:scale-[0.98]" onClick={() => setView('home')}>
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#3b0b0f] ring-1 ring-[#E50914]/30"><BookOpen className="h-5 w-5 text-[#E50914]" /></span>
          <span className="hidden sm:inline">MANHWA</span>
        </button>
        <nav className="hidden items-center gap-1.5 md:flex">
          <button className={navClass(view === 'home')} onClick={() => setView('home')}><Home className="h-4 w-4" />Browse</button>
          <button className={navClass(view === 'admin' || (!session && view === 'auth'))} onClick={openAdmin}>{isAdmin ? <><UploadCloud className="h-4 w-4" />Admin</> : 'Sign in'}</button>
          {view === 'series' && <span className="ml-2 max-w-48 truncate border-l border-white/10 pl-3 text-sm text-gray-500">{seriesTitle}</span>}
          {view === 'admin' && <span className="ml-2 border-l border-white/10 pl-3 text-sm text-gray-500">Admin</span>}
        </nav>
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
          <label className="flex min-w-0 max-w-[360px] flex-1 items-center gap-2 rounded-lg border border-white/10 bg-[#202020] px-3 py-2 transition focus-within:border-white/20 focus-within:ring-2 focus-within:ring-[#E50914]/20 md:flex-none">
            <Search className="h-4 w-4 shrink-0 text-gray-500" />
            <span className="sr-only">Search library</span>
            <input aria-label="Search library" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={view === 'home' ? 'Search title or genre' : 'Search'} className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-gray-500 md:w-56" />
          </label>
          {session && <UserMenu {...menuProps} />}
        </div>
      </div>
    </div>
    <div className="border-t border-white/[0.04] bg-[#171717] md:hidden">
      <nav className="mx-auto flex w-full max-w-[1800px] gap-1.5 overflow-x-auto px-4 py-2 sm:px-6">
        <button className={navClass(view === 'home')} onClick={() => setView('home')}><Home className="h-4 w-4" />Browse</button>
        <button className={navClass(view === 'admin' || (!session && view === 'auth'))} onClick={openAdmin}>{isAdmin ? <><UploadCloud className="h-4 w-4" />Admin</> : 'Sign in'}</button>
      </nav>
    </div>
  </header>
}

function UserMenu({ username, email, updateUsername, changePassword, readerWidth, updateReaderWidth, clearReadingProgress, clearFavorites, favoritesCount, deleteAccount, signOut }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(username)
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { setValue(username) }, [username])

  async function saveUsername(event) {
    event.preventDefault(); setBusy(true); setMessage('')
    try { await updateUsername(value); setMessage('Username updated.') } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  async function savePassword(event) {
    event.preventDefault(); setBusy(true); setMessage('')
    try { await changePassword(password); setPassword(''); setMessage('Password updated.') } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  async function removeAccount() {
    setBusy(true); setMessage('')
    try { await deleteAccount() } catch (error) { setMessage(error.message || 'Account deletion is not available yet.') } finally { setBusy(false) }
  }

  function clearProgress() { clearReadingProgress(); setMessage('Reading progress cleared.') }
  function clearSavedFavorites() { clearFavorites(); setMessage('Favorites cleared.') }

  const settingsDialog = open && createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#080808]/80 p-3 backdrop-blur-sm sm:p-6" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="profile-settings-title" className="mx-auto my-4 w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#202020] shadow-[0_24px_80px_rgba(10,10,10,0.45)] sm:my-10" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-[#252525] p-5 sm:p-6">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#3b0b0f] text-[#E50914] ring-1 ring-[#E50914]/30"><UserCircle size={28} weight="duotone" /></div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#E50914]">Account</p>
              <h2 id="profile-settings-title" className="mt-1 truncate text-xl font-bold text-white">Profile settings</h2>
              <p className="mt-1 text-sm text-gray-400">Manage your account and reader preferences.</p>
            </div>
          </div>
          <button onClick={() => setOpen(false)} aria-label="Close profile settings" className="rounded-lg p-2 text-gray-400 transition hover:bg-white/[0.06] hover:text-white active:scale-95"><ProfileX size={20} weight="bold" /></button>
        </div>
        <div className="grid md:grid-cols-[0.78fr_1.22fr]">
          <aside className="border-b border-white/10 p-5 sm:p-6 md:border-b-0 md:border-r">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Signed in as</p>
            <p className="mt-2 break-all text-sm font-semibold text-gray-200">{email}</p>
            <div className="mt-8 border-t border-white/[0.08] pt-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Username</p>
              <p className="mt-2 text-lg font-bold text-white">{username || 'Not set'}</p>
            </div>
            <div className="mt-6 border-t border-white/[0.08] pt-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Reader default</p>
              <p className="mt-2 text-sm font-semibold text-gray-200">{readerWidth === 'fixed' ? '800px' : readerWidth === 'full' ? '100% width' : 'Fit width'}</p>
            </div>
          </aside>
          <div className="space-y-7 p-5 sm:p-6">
            <section>
              <div className="flex items-start gap-3"><div className="mt-0.5 rounded-lg bg-white/[0.06] p-2 text-gray-300"><UserCircle size={19} /></div><div><h3 className="font-bold text-white">Username</h3><p className="mt-1 text-xs leading-relaxed text-gray-500">This name appears on your profile.</p></div></div>
              <form onSubmit={saveUsername} className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><label className="grid gap-2 text-xs font-semibold text-gray-400">Username<input required minLength={2} maxLength={30} value={value} onChange={(event) => setValue(event.target.value)} placeholder="Enter a username" className="field" /></label><button disabled={busy} className="primary-button w-full text-sm sm:w-auto">Save</button></form>
            </section>
            <section className="border-t border-white/[0.08] pt-6">
              <div className="flex items-start gap-3"><div className="mt-0.5 rounded-lg bg-white/[0.06] p-2 text-gray-300"><Key size={19} /></div><div><h3 className="font-bold text-white">Security</h3><p className="mt-1 text-xs leading-relaxed text-gray-500">Update your password whenever you need.</p></div></div>
              <form onSubmit={savePassword} className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><label className="grid gap-2 text-xs font-semibold text-gray-400">New password<input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" className="field" /></label><button disabled={busy} className="primary-button w-full text-sm sm:w-auto">Change</button></form>
            </section>
            <section className="border-t border-white/[0.08] pt-6">
              <div className="flex items-start gap-3"><div className="mt-0.5 rounded-lg bg-white/[0.06] p-2 text-gray-300"><MonitorPlay size={19} /></div><div><h3 className="font-bold text-white">Reading</h3><p className="mt-1 text-xs leading-relaxed text-gray-500">Choose how wide pages should appear by default.</p></div></div>
              <label className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-[#181818] p-3 text-sm"><span className="font-semibold text-gray-300">Default image width</span><select value={readerWidth} onChange={(event) => updateReaderWidth(event.target.value)} className="rounded-lg border border-white/10 bg-[#303030] px-2.5 py-2 text-xs text-white outline-none focus:border-[#E50914]"><option value="wide">Fit width</option><option value="fixed">800px</option><option value="full">100%</option></select></label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2"><button type="button" onClick={clearProgress} className="rounded-lg bg-[#303030] px-3 py-2.5 text-xs font-semibold text-gray-300 transition hover:bg-[#3a3a3a] hover:text-white active:scale-[0.98]">Clear progress</button><button type="button" onClick={clearSavedFavorites} className="rounded-lg bg-[#303030] px-3 py-2.5 text-xs font-semibold text-gray-300 transition hover:bg-[#3a3a3a] hover:text-white active:scale-[0.98]">Clear favorites ({favoritesCount})</button></div>
            </section>
            <section className="border-t border-red-500/20 pt-6">
              <div className="flex items-start gap-3"><div className="mt-0.5 rounded-lg bg-red-500/10 p-2 text-red-300"><Trash size={19} /></div><div><h3 className="font-bold text-red-300">Danger zone</h3><p className="mt-1 text-xs leading-relaxed text-gray-500">Deleting your account permanently removes your login.</p></div></div>
              <button type="button" disabled={busy} onClick={removeAccount} className="mt-4 w-full rounded-lg border border-red-500/30 px-3 py-2.5 text-sm font-semibold text-red-300 transition hover:bg-red-950/50 active:scale-[0.98]">Delete account</button>
            </section>
          </div>
        </div>
        {message && <p role="status" className="border-t border-white/10 bg-[#181818] px-5 py-3 text-sm text-gray-300 sm:px-6">{message}</p>}
        <div className="border-t border-white/10 bg-[#252525] p-4 sm:px-6"><button type="button" onClick={signOut} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#303030] px-3 py-2.5 text-sm font-semibold text-gray-300 transition hover:bg-[#3a3a3a] hover:text-white active:scale-[0.98]"><SignOut size={18} />Sign out</button></div>
      </div>
    </div>, document.body)
  return <div className="relative shrink-0"><button aria-label="Open user settings" title={username ? `${username} settings` : 'User settings'} aria-expanded={open} onClick={() => setOpen(!open)} className={`rounded-lg p-2 transition duration-200 active:scale-95 ${open ? 'bg-[#3b0b0f] text-white ring-1 ring-[#E50914]/30' : 'text-gray-400 hover:bg-white/[0.06] hover:text-white'}`}><UserCircle size={20} /></button>{settingsDialog}</div>
}

function AuthView({ back, onAuthenticated }) {
  const [mode, setMode] = useState('signin')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault(); setBusy(true); setMessage('')
    try {
      if (mode === 'signup' && !username.trim()) throw new Error('Enter a username.')
      const result = mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin, data: { username: username.trim() } } })
      if (result.error) throw result.error
      if (mode === 'signup' && !result.data.session) setMessage('Account created. Check your email, then sign in.')
      else onAuthenticated()
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  return <section className="mx-auto max-w-md"><button onClick={back} className="mb-6 flex items-center gap-2 text-sm text-gray-400 hover:text-white"><ArrowLeft className="h-4 w-4" />Back to browse</button><div className="rounded-xl bg-[#232323] p-6"><h1 className="mb-2 text-3xl font-black">{mode === 'signin' ? 'Sign in' : 'Create account'}</h1><p className="mb-6 text-sm text-gray-400">Only the account added as an admin can upload files.</p><form onSubmit={submit} className="space-y-4">{mode === 'signup' && <input required minLength={2} maxLength={30} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" autoComplete="username" className="field" />}<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" autoComplete="email" className="field" /><input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} className="field" /><button disabled={busy} className="primary-button w-full">{busy ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}</button></form>{message && <p className="mt-4 text-sm text-gray-300">{message}</p>}<button onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage('') }} className="mt-5 text-sm text-gray-400 hover:text-white">{mode === 'signin' ? 'Create a new account' : 'Already have an account? Sign in'}</button></div></section>
}

function HomeView({ series, openSeries, openAdmin, genres, selectedGenre, setSelectedGenre, favoritesOnly, setFavoritesOnly, favoritesCount, favorites, toggleFavorite }) {
  return <section><div className="relative mb-10 overflow-hidden rounded-xl bg-gradient-to-r from-[#3b0b0f] to-[#232323] p-6 sm:p-8 md:p-14"><div className="relative z-10 max-w-xl"><p className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-[#E50914]">Personal library</p><h1 className="mb-4 text-3xl font-black sm:text-4xl md:text-6xl">Read your way.</h1><p className="mb-6 text-gray-300">Upload a chapter PDF, convert it in your browser, and read it as a smooth vertical webtoon.</p><button onClick={openAdmin} className="rounded-md bg-[#E50914] px-5 py-3 font-bold hover:bg-red-700">Upload a chapter</button></div></div><div className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5"><div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#E50914]">Library</p><h2 className="text-2xl font-bold tracking-tight">Your series</h2></div><div className="flex items-center gap-3"><span className="text-sm text-gray-500">{series.length} titles</span><button onClick={() => setFavoritesOnly(!favoritesOnly)} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${favoritesOnly ? 'bg-[#E50914] text-white' : 'bg-[#232323] text-gray-400 hover:bg-[#303030] hover:text-white'}`}>{favoritesOnly ? 'Favorites' : `Favorites ${favoritesCount}`}</button></div></div>{genres.length > 0 && <div className="mb-8"><div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Browse by genre</h3>{selectedGenre && <button onClick={() => setSelectedGenre('')} className="text-xs font-semibold text-[#E50914] hover:text-red-300">Clear</button>}</div><div className="genre-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"><button aria-pressed={selectedGenre === ''} onClick={() => setSelectedGenre('')} className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${selectedGenre === '' ? 'bg-[#E50914] text-white' : 'bg-[#232323] text-gray-400 hover:bg-[#303030] hover:text-white'}`}>All</button>{genres.map((genre) => <button aria-pressed={selectedGenre === genre} key={genre} onClick={() => setSelectedGenre(selectedGenre === genre ? '' : genre)} className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${selectedGenre === genre ? 'bg-[#E50914] text-white' : 'bg-[#232323] text-gray-400 hover:bg-[#303030] hover:text-white'}`}>{genre}</button>)}</div></div>}{series.length === 0 ? <EmptyState text={favoritesOnly ? 'No favorites yet. Tap the star on a series to save it.' : selectedGenre ? `No series found in ${selectedGenre}.` : 'No series yet. Create one from Admin.'} /> : <div className="grid grid-cols-[repeat(auto-fill,minmax(125px,170px))] justify-start gap-3 sm:gap-4">{series.map((item) => <SeriesCard key={item.id} series={item} onClick={() => openSeries(item)} isFavorite={favorites.includes(item.id)} toggleFavorite={() => toggleFavorite(item)} />)}</div>}</section>
}

function SeriesCard({ series, onClick, isFavorite, toggleFavorite }) { return <div className="group relative overflow-hidden rounded-lg bg-[#232323] transition hover:-translate-y-1 hover:ring-2 hover:ring-[#E50914]"><button className="block w-full text-left" onClick={onClick}><Cover series={series} /><div className="p-3"><h3 className="truncate pr-7 font-bold">{series.title}</h3><p className="mt-1 text-xs text-gray-500">Open series</p></div></button><button aria-label={isFavorite ? `Remove ${series.title} from favorites` : `Add ${series.title} to favorites`} onClick={toggleFavorite} className="absolute right-2 top-2 rounded-full bg-black/60 p-2 text-gray-300 backdrop-blur hover:text-yellow-300"><span className={isFavorite ? 'text-yellow-300' : ''}>★</span></button></div> }
function Cover({ series, className = '' }) { return series.cover_image_url ? <img src={series.cover_image_url} alt="" className={`aspect-[2/3] w-full object-cover ${className}`} /> : <div className={`flex aspect-[2/3] items-end bg-gradient-to-br from-[#5c1118] via-[#292929] to-[#111] p-4 ${className}`}><span className="text-2xl font-black">{series.title.slice(0, 1).toUpperCase()}</span></div> }

function SeriesView({ series, chapters, back, openReader, isAdmin, deleteSeries, deleteChapter, updateSeries, lastRead, continueReading }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(series.title)
  const [description, setDescription] = useState(series.description || '')
  const [cover, setCover] = useState(null)
  const genres = extractGenres(series.description || '')
  const cleanDescription = removeGenreTags(series.description || '')

  function startEditing() {
    setTitle(series.title); setDescription(series.description || ''); setCover(null); setEditing(true)
  }

  async function saveChanges(event) {
    event.preventDefault()
    if (await updateSeries(series, { title, description, cover })) { setEditing(false); setCover(null) }
  }

  const hasSavedChapter = lastRead?.seriesId === series.id && chapters.some((chapter) => chapter.id === lastRead.chapterId || Number(chapter.chapter_number) === Number(lastRead.chapterNumber))
  return <section><button onClick={back} className="mb-6 flex items-center gap-2 text-sm text-gray-400 hover:text-white"><ArrowLeft className="h-4 w-4" />Back to browse</button><div className="grid gap-8 md:grid-cols-[220px_1fr]"><Cover series={series} className="rounded-lg" /><div><div className="flex items-start justify-between gap-4"><div><p className="mb-2 text-sm font-bold uppercase tracking-widest text-[#E50914]">Series</p><h1 className="mb-4 text-4xl font-black">{series.title}</h1></div>{isAdmin && <div className="flex gap-2"><button onClick={startEditing} className="rounded bg-[#303030] px-3 py-2 text-xs text-gray-200 hover:bg-[#3a3a3a]"><Pencil className="mr-1 inline h-3 w-3" />Edit</button><button onClick={() => deleteSeries(series)} className="rounded bg-red-950/60 px-3 py-2 text-xs text-red-200 hover:bg-red-900"><Trash2 className="mr-1 inline h-3 w-3" />Delete</button></div>}</div>{editing ? <form onSubmit={saveChanges} className="mb-8 space-y-3 rounded-lg bg-[#232323] p-4"><input required value={title} onChange={(event) => setTitle(event.target.value)} className="field" placeholder="Title" /><textarea value={description} onChange={(event) => setDescription(event.target.value)} className="field min-h-24" placeholder="Description (add tags like #Action #Fantasy)" /><input type="file" accept="image/*" onChange={(event) => setCover(event.target.files?.[0] || null)} className="field file:mr-3 file:rounded file:border-0 file:bg-[#E50914] file:px-3 file:py-2 file:text-white" /><div className="flex gap-2"><button className="primary-button">Save changes</button><button type="button" onClick={() => setEditing(false)} className="rounded bg-[#303030] px-4 py-3 text-sm">Cancel</button></div></form> : <div className="mb-8"><p className="max-w-2xl text-gray-400">{cleanDescription || 'No description yet.'}</p>{genres.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{genres.map((genre) => <span key={genre} className="rounded-full bg-[#3b0b0f] px-3 py-1 text-xs font-semibold text-red-200">{genre}</span>)}</div>}</div>}{hasSavedChapter && <div className="mb-8 flex flex-col gap-3 rounded-lg border border-white/10 bg-[#232323] p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs uppercase tracking-widest text-[#E50914]">Continue reading</p><p className="font-bold">Chapter {lastRead.chapterNumber}</p></div><button onClick={continueReading} className="w-full rounded bg-[#E50914] px-4 py-3 text-sm font-bold hover:bg-red-700 sm:w-auto">Continue</button></div>}<h2 className="mb-3 text-xl font-bold">Chapters</h2>{chapters.length === 0 ? <EmptyState text="No chapters uploaded yet." /> : <div className="space-y-2">{chapters.map((chapter) => <div key={chapter.id} className="flex items-center gap-2"><button onClick={() => openReader(chapter)} className="flex min-w-0 flex-1 items-center justify-between rounded-lg bg-[#232323] px-4 py-4 text-left hover:bg-[#303030]"><span>Chapter {chapter.chapter_number}</span><span className="text-sm text-gray-500">{chapter.page_count} pages <ChevronRight className="ml-2 inline h-4 w-4" /></span></button>{isAdmin && <button onClick={() => deleteChapter(chapter)} aria-label={`Delete chapter ${chapter.chapter_number}`} className="rounded bg-red-950/60 p-3 text-red-200 hover:bg-red-900"><Trash2 className="h-4 w-4" /></button>}</div>)}</div>}</div></div></section>
}

function ReaderView({ series, chapter, chapters, back, openReader, readerWidth, updateReaderWidth }) {
  const index = chapters.findIndex((item) => item.id === chapter.id)
  const previous = chapters[index - 1]
  const next = chapters[index + 1]
  const [width, setWidth] = useState(readerWidth)
  const [currentPage, setCurrentPage] = useState(1)
  const progressKey = `manhwa-reader-progress:${series.id}:${chapter.id}`
  const restoredKey = useRef('')
  const currentPageRef = useRef(1)
  const touchStart = useRef(null)

  function handleTouchStart(event) {
    touchStart.current = { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY }
  }

  function handleTouchEnd(event) {
    if (touchStart.current === null) return
    const deltaX = event.changedTouches[0].clientX - touchStart.current.x
    const deltaY = event.changedTouches[0].clientY - touchStart.current.y
    touchStart.current = null
    if (Math.abs(deltaX) < 70 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return
    if (deltaX < 0 && next) openReader(next)
    if (deltaX > 0 && previous) openReader(previous)
  }

  useEffect(() => {
    const savedPage = readReaderProgress(progressKey, chapter.page_count)
    restoredKey.current = ''
    currentPageRef.current = savedPage
    setCurrentPage(savedPage)
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (visible) {
        const nextPage = Number(visible.target.dataset.page)
        if (nextPage !== currentPageRef.current) {
          currentPageRef.current = nextPage
          setCurrentPage(nextPage)
        }
      }
    }, { rootMargin: '-20% 0px -60% 0px' })

    document.querySelectorAll('[data-reader-page]').forEach((page) => observer.observe(page))
    const restoreTimer = setTimeout(() => {
      document.getElementById(`reader-page-${chapter.id}-${savedPage}`)?.scrollIntoView({ behavior: 'auto', block: 'start' })
      restoredKey.current = progressKey
      saveReaderProgress(progressKey, savedPage)
    }, 100)
    return () => { observer.disconnect(); clearTimeout(restoreTimer) }
  }, [chapter.id, chapter.page_count, progressKey])

  useEffect(() => {
    if (restoredKey.current === progressKey) saveReaderProgress(progressKey, currentPage)
  }, [currentPage, progressKey])

  useEffect(() => { setWidth(readerWidth) }, [readerWidth])

  return <section onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} className="reader-pages min-h-screen bg-black"><div className="sticky top-0 z-10 border-b border-white/10 bg-[#181818]/95 px-2 py-2 backdrop-blur sm:px-4 sm:py-3"><div className="flex items-center justify-between gap-2"><button onClick={back} className="flex min-h-10 items-center gap-1 rounded px-2 text-sm text-gray-300 hover:bg-[#303030] hover:text-white sm:gap-2 sm:px-3"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Exit reader</span><span className="sm:hidden">Exit</span></button><span className="min-w-0 truncate text-xs font-bold sm:text-sm">{series.title} - Chapter {chapter.chapter_number}</span><select value={width} onChange={(event) => { setWidth(event.target.value); updateReaderWidth(event.target.value) }} className="min-h-10 rounded bg-[#303030] px-2 text-xs"><option value="wide">Fit width</option><option value="fixed">800px</option><option value="full">100%</option></select></div></div><div className="pointer-events-none fixed bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-[#181818]/90 px-2 py-1 text-[10px] text-gray-400 shadow backdrop-blur">{currentPage}/{chapter.page_count}</div><div className={`mx-auto ${width === 'fixed' ? 'max-w-[800px]' : width === 'full' ? 'max-w-none' : 'max-w-4xl'}`}>{!isSupabaseConfigured && <div className="p-8 text-center text-gray-400">Configure Supabase to load chapter images.</div>}{isSupabaseConfigured && Array.from({ length: chapter.page_count }, (_, index) => index + 1).map((page) => <img id={`reader-page-${chapter.id}-${page}`} data-reader-page="true" data-page={page} key={page} loading="lazy" decoding="async" src={getPublicUrl(chapterPagePath(series.id, chapter.chapter_number, page))} alt={`Page ${page}`} className="reader-page" />)}</div><div className="mx-auto flex max-w-4xl gap-3 p-4 sm:justify-between sm:gap-4 sm:p-5"><button disabled={!previous} onClick={() => openReader(previous)} className="min-h-12 flex-1 rounded bg-[#232323] px-3 py-3 text-sm disabled:opacity-30 sm:flex-none sm:px-4"><ChevronLeft className="mr-1 inline h-4 w-4" />Previous</button><button disabled={!next} onClick={() => openReader(next)} className="min-h-12 flex-1 rounded bg-[#E50914] px-3 py-3 text-sm disabled:opacity-30 sm:flex-none sm:px-4">Next<ChevronRight className="ml-1 inline h-4 w-4" /></button></div></section>
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
    const failed = []
    try {
      for (const [index, item] of chapterFiles.entries()) {
        const label = `Chapter ${item.chapterNumber} (${index + 1}/${chapterFiles.length})`
        try {
          await uploadChapterFile(item.file, item.chapterNumber, label)
        } catch (error) {
          failed.push({ item, error })
          setProgress(`${label} failed: ${error.message}`)
        }
      }
      if (failed.length) {
        setChapterFiles(failed.map(({ item }) => item))
        const failedNumbers = failed.map(({ item }) => item.chapterNumber).join(', ')
        setMessage(`Upload finished with ${failed.length} failed chapter(s): ${failedNumbers}. Select Upload again to retry them.`)
        setProgress(`Uploaded ${chapterFiles.length - failed.length}; failed ${failed.length}.`)
      } else {
        setChapterFiles([]); setProgress(`Uploaded ${chapterFiles.length} chapters.`)
      }
    } finally { setBusy(false) }
  }

  return <section className="mx-auto w-full max-w-[1400px]"><button onClick={back} className="mb-6 flex items-center gap-2 text-sm text-gray-400 hover:text-white"><ArrowLeft className="h-4 w-4" />Back to browse</button><h1 className="mb-8 text-4xl font-black">Admin</h1><div className="grid gap-6 md:grid-cols-2"><form onSubmit={createSeries} className="space-y-4 rounded-xl bg-[#232323] p-5"><h2 className="text-xl font-bold">New series</h2><input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" className="field" /><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" className="field min-h-28" /><input type="file" accept="image/*" onChange={(event) => setCover(event.target.files?.[0] || null)} className="field file:mr-3 file:rounded file:border-0 file:bg-[#E50914] file:px-3 file:py-2 file:text-white" /><button disabled={busy} className="primary-button"><Plus className="inline h-4 w-4" /> Create series</button></form><form onSubmit={uploadChapters} className="space-y-4 rounded-xl bg-[#232323] p-5"><h2 className="text-xl font-bold">Upload chapters</h2><select required value={seriesId} onChange={(event) => setSeriesId(event.target.value)} className="field"><option value="">Choose series</option>{series.filter((item) => !item.id.startsWith('demo-')).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><div className="flex gap-2"><button type="button" onClick={() => filesInput.current?.click()} className="flex-1 rounded bg-[#303030] px-3 py-2 text-sm hover:bg-[#3a3a3a]">Choose PDF files</button><button type="button" onClick={() => folderInput.current?.click()} className="flex-1 rounded bg-[#303030] px-3 py-2 text-sm hover:bg-[#3a3a3a]">Choose folder</button></div><input ref={filesInput} type="file" accept=".pdf,application/pdf" multiple onChange={selectChapterFiles} className="hidden" /><input ref={folderInput} type="file" accept=".pdf,application/pdf" multiple webkitdirectory="" directory="" onChange={selectChapterFiles} className="hidden" /><p className="text-xs text-gray-500">Choose one PDF, multiple PDFs, or a folder. Filenames need a chapter number, such as Chapter 1.pdf.</p>{chapterFiles.length > 0 && <div className="max-h-32 overflow-auto rounded bg-[#181818] p-3 text-xs text-gray-400">{chapterFiles.map((item) => <div key={`${item.file.name}-${item.file.lastModified}`}>{item.chapterNumber === null ? '?' : `Chapter ${item.chapterNumber}`} - {item.file.name}</div>)}</div>}<button disabled={busy} className="primary-button"><UploadCloud className="inline h-4 w-4" /> Upload {chapterFiles.length || ''} chapters</button>{progress && <p className="text-sm text-gray-400">{progress}</p>}</form></div></section>
}

function EmptyState({ text }) { return <div className="rounded-lg border border-dashed border-white/15 p-8 text-center text-gray-500">{text}</div> }
function readReaderProgress(key, pageCount) {
  try {
    const page = Number(localStorage.getItem(key))
    return page >= 1 && page <= pageCount ? page : 1
  } catch { return 1 }
}
function saveReaderProgress(key, page) {
  try { localStorage.setItem(key, String(page)) } catch { /* Browser storage may be unavailable. */ }
}
function readReaderWidth() {
  try { return ['wide', 'fixed', 'full'].includes(localStorage.getItem('manhwa-reader-width')) ? localStorage.getItem('manhwa-reader-width') : 'wide' } catch { return 'wide' }
}
function saveReaderWidth(width) {
  try { localStorage.setItem('manhwa-reader-width', width) } catch { /* Browser storage may be unavailable. */ }
}
function clearSavedProgress() {
  try {
    Object.keys(localStorage).filter((key) => key.startsWith('manhwa-reader-progress:')).forEach((key) => localStorage.removeItem(key))
    localStorage.removeItem('manhwa-last-read')
  } catch { /* Browser storage may be unavailable. */ }
}
function favoritesKey(userId) { return `manhwa-favorites:${userId || 'guest'}` }
function readFavorites(userId) {
  try { return JSON.parse(localStorage.getItem(favoritesKey(userId))) || [] } catch { return [] }
}
function saveFavorites(key, favorites) {
  try { localStorage.setItem(key, JSON.stringify(favorites)) } catch { /* Browser storage may be unavailable. */ }
}
function readLastRead() {
  try { return JSON.parse(localStorage.getItem('manhwa-last-read')) || null } catch { return null }
}
function saveLastRead(reading) {
  try { localStorage.setItem('manhwa-last-read', JSON.stringify(reading)) } catch { /* Browser storage may be unavailable. */ }
}
function extractGenres(text) { return [...new Set((text.match(/#[\w-]+/g) || []).map((tag) => tag.slice(1)))] }
function removeGenreTags(text) { return text.replace(/#[\w-]+/g, '').replace(/[ \t]{2,}/g, ' ').trim() }
function chapterNumberFromName(name) {
  const baseName = name.replace(/\.pdf$/i, '')
  const match = baseName.match(/(?:chapter|ch|episode|ep)[^\d]*(\d+(?:\.\d+)?)/i) || baseName.match(/(?:^|[\s._-])(\d+(?:\.\d+)?)(?:$|[\s._-])/)
  return match ? Number(match[1]) : null
}
function chapterPagePath(seriesId, chapterNumber, page) { return `${chapterFolder(seriesId, chapterNumber)}/${page}.webp` }

export default App
