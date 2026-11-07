import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  ArrowDown,
  ArrowUp,
  ArrowRight,
  Check,
  Circle,
  FolderOpen,
  LockKeyhole,
  LogOut,
  Mail,
  Pin,
  Plus,
  Save,
  Trash2,
  Workflow,
} from 'lucide-react'
import FlowCanvas from './components/FlowCanvas'
import StepMatrix from './components/StepMatrix'
import { isSupabaseConfigured, supabase } from './supabaseClient'
import {
  deleteProcessDiagram,
  fetchProcessDiagrams,
  saveProcessDiagram,
} from './services/processDiagrams'
import type { Lane, ProcessDiagram, Step } from './types'
import { deriveLanes, setPinnedLane } from './services/lanes'
import { validateBpmnProcess } from './validation/validateBpmnProcess'
import './App.css'

const initialTitle = 'Customer Onboarding Flow'
const defaultFolder = 'General'
const initialSteps: Step[] = [
  {
    id: 'STEP-001',
    stepName: 'Submit Request',
    department: 'Sales',
    stepType: 'Start Event',
    predecessorId: '',
    condition: '',
  },
  {
    id: 'STEP-002',
    stepName: 'Review Application',
    department: 'Finance',
    stepType: 'Task',
    predecessorId: 'STEP-001',
    condition: '',
  },
  {
    id: 'STEP-003',
    stepName: 'Approve/Reject',
    department: 'HR',
    stepType: 'Decision Point',
    predecessorId: 'STEP-002',
    condition: 'Yes / No',
  },
]

type Notice = { type: 'error' | 'success'; message: string }

function getErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }

  return error instanceof Error ? error.message : 'Unknown error'
}

function createDefaultStep(): Step {
  return {
    id: 'STEP-001',
    stepName: '',
    department: '',
    stepType: 'Task',
    predecessorId: '',
    condition: '',
  }
}

function App() {
  const [initialLaneState] = useState(() => deriveLanes(initialSteps, []))
  const [user, setUser] = useState<User | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(isSupabaseConfigured)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [steps, setSteps] = useState<Step[]>(initialLaneState.steps)
  const [lanes, setLanes] = useState<Lane[]>(initialLaneState.lanes)
  const skipNextLaneDerivationRef = useRef(false)
  const skipNextAutoPreviewRef = useRef(false)
  const [previewSteps, setPreviewSteps] = useState<Step[]>(initialLaneState.steps)
  const [title, setTitle] = useState(initialTitle)
  const [folder, setFolder] = useState(defaultFolder)
  const [owner, setOwner] = useState('')
  const [previewTitle, setPreviewTitle] = useState(initialTitle)
  const [savedDiagrams, setSavedDiagrams] = useState<ProcessDiagram[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [isLoadingDiagrams, setIsLoadingDiagrams] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [isFlowchartCleared, setIsFlowchartCleared] = useState(false)
  const [matrixKey, setMatrixKey] = useState(0)
  const [savedSnapshot, setSavedSnapshot] = useState<string>(
    JSON.stringify({
      title: initialTitle,
      folder: defaultFolder,
      owner: '',
      lanes: initialLaneState.lanes,
      steps: initialLaneState.steps,
    }),
  )
  const hasUnsavedChanges =
    JSON.stringify({ title, folder, owner, lanes, steps }) !== savedSnapshot
  const validationIssues = useMemo(() => validateBpmnProcess(steps), [steps])
  const folderNames = useMemo(
    () => [...new Set([defaultFolder, ...savedDiagrams.map((diagram) => diagram.folder)])].sort(),
    [savedDiagrams],
  )
  const ownerNames = useMemo(
    () => [...new Set(savedDiagrams.map((diagram) => diagram.owner).filter((name): name is string => Boolean(name?.trim())))].sort(),
    [savedDiagrams],
  )

  const updatePreview = useCallback((generatedSteps: Step[]) => {
    setPreviewSteps(generatedSteps)
    setPreviewTitle(title)
    setIsFlowchartCleared(false)
  }, [title])

  useEffect(() => {
    if (skipNextAutoPreviewRef.current) {
      skipNextAutoPreviewRef.current = false
      return
    }

    updatePreview(steps.map((step) => ({ ...step })))
  }, [steps, updatePreview])

  useEffect(() => {
    if (skipNextLaneDerivationRef.current) {
      skipNextLaneDerivationRef.current = false
      return
    }

    const derived = deriveLanes(steps, lanes)
    if (derived.steps.some((step, index) => step.laneId !== steps[index]?.laneId)) {
      setSteps(derived.steps)
    }
    if (
      derived.lanes.length !== lanes.length ||
      derived.lanes.some((lane, index) =>
        lane.id !== lanes[index]?.id || lane.name !== lanes[index]?.name)
    ) {
      setLanes(derived.lanes)
    }
  }, [steps, lanes])

  useEffect(() => {
    if (!supabase) return undefined

    let active = true
    let receivedAuthEvent = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      receivedAuthEvent = true
      setUser(session?.user ?? null)
      setIsAuthLoading(false)
      setAuthError('')
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
        setSavedDiagrams([])
        setIsLoadingDiagrams(Boolean(session?.user))
      }
    })

    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!active) return
        if (error) throw error
        if (!receivedAuthEvent) {
          setUser(data.session?.user ?? null)
          setIsLoadingDiagrams(Boolean(data.session?.user))
        }
      })
      .catch((error) => {
        if (active) {
          setAuthError(`Could not restore your session: ${getErrorMessage(error)}`)
        }
      })
      .finally(() => {
        if (active) setIsAuthLoading(false)
      })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!supabase || !user) return undefined

    let active = true
    fetchProcessDiagrams(supabase)
      .then((diagrams) => {
        if (active) setSavedDiagrams(diagrams)
      })
      .catch((error) => {
        if (active) {
          setSavedDiagrams([])
          setNotice({
            type: 'error',
            message: `Could not load saved flowcharts: ${getErrorMessage(error)}`,
          })
        }
      })
      .finally(() => {
        if (active) setIsLoadingDiagrams(false)
      })

    return () => {
      active = false
    }
  }, [user])

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return

    setIsSigningIn(true)
    setAuthError('')
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    } catch (error) {
      setAuthError(getErrorMessage(error) || 'Could not sign in. Please try again.')
    } finally {
      setIsSigningIn(false)
    }
  }

  async function handleSignOut() {
    if (!supabase) return

    setIsSigningOut(true)
    setAuthError('')
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } catch (error) {
      setAuthError(getErrorMessage(error) || 'Could not sign out. Please try again.')
    } finally {
      setIsSigningOut(false)
    }
  }

  async function saveProcess(asNew = false) {
    const processTitle = title.trim()
    if (!processTitle) {
      setNotice({ type: 'error', message: 'Enter a title before saving this flowchart.' })
      return
    }

    if (!supabase) {
      setNotice({
        type: 'error',
        message: 'Supabase is not configured. Your flowchart is available in this session but cannot be saved.',
      })
      return
    }

    setIsSaving(true)
    setNotice(null)

    try {
      const derived = deriveLanes(steps, lanes)
      const data = await saveProcessDiagram(
        supabase,
        {
          title: processTitle,
          steps: derived.steps,
          folder: folder.trim() || defaultFolder,
          owner: owner.trim() || null,
          lanes: derived.lanes,
        },
        { id: currentId, asNew },
      )

      const savedSteps = data.steps
      const savedLanes = data.lanes ?? derived.lanes
      const savedId = String(data.id)
      setCurrentId(savedId)
      setTitle(data.title)
      setFolder(data.folder)
      setOwner(data.owner ?? '')
      setSteps(savedSteps)
      setLanes(savedLanes)
      setPreviewTitle(data.title)
      setPreviewSteps(savedSteps)
      setIsFlowchartCleared(false)
      setSavedSnapshot(
        JSON.stringify({
          title: data.title,
          folder: data.folder,
          owner: data.owner ?? '',
          lanes: savedLanes,
          steps: savedSteps,
        }),
      )
      setSavedDiagrams((currentDiagrams) => {
        const updatedDiagrams = [
          ...currentDiagrams.filter((diagram) => diagram.id !== data.id),
          data,
        ]
        return updatedDiagrams.sort((left, right) => left.title.localeCompare(right.title))
      })
      setNotice({
        type: 'success',
        message: asNew ? 'Flowchart saved as a copy.' : 'Flowchart saved successfully.',
      })
    } catch (error) {
      setNotice({ type: 'error', message: `Could not save flowchart: ${getErrorMessage(error)}` })
    } finally {
      setIsSaving(false)
    }
  }

  function handleSaveToDatabase() {
    return saveProcess()
  }

  function handleSaveAsNew() {
    return saveProcess(true)
  }

  function resetWorkspace() {
    const derived = deriveLanes([createDefaultStep()], [])
    const newSteps = derived.steps
    setTitle('')
    setFolder(defaultFolder)
    setOwner('')
    skipNextAutoPreviewRef.current = true
    skipNextLaneDerivationRef.current = true
    setLanes(derived.lanes)
    setSteps(newSteps)
    setPreviewSteps([])
    setPreviewTitle('')
    setCurrentId(null)
    setIsFlowchartCleared(true)
    setMatrixKey((currentKey) => currentKey + 1)
    setNotice(null)
    setSavedSnapshot(JSON.stringify({
      title: '',
      folder: defaultFolder,
      owner: '',
      lanes: derived.lanes,
      steps: newSteps,
    }))
  }

  function loadProcess(event: ChangeEvent<HTMLSelectElement>) {
    const diagram = savedDiagrams.find(
      (savedDiagram) => String(savedDiagram.id) === event.target.value,
    )

    if (!diagram) {
      setCurrentId(null)
      return
    }

    setCurrentId(String(diagram.id))
    setTitle(diagram.title)
    setFolder(diagram.folder)
    setOwner(diagram.owner ?? '')
    const existingLanes = diagram.lanes ?? []
    const derived = deriveLanes(diagram.steps, existingLanes)
    const loadedSteps = derived.steps
    skipNextLaneDerivationRef.current = true
    setLanes(derived.lanes)
    setSteps(loadedSteps)
    setPreviewSteps(loadedSteps)
    setPreviewTitle(diagram.title)
    setSavedSnapshot(
      JSON.stringify({
        title: diagram.title,
        folder: diagram.folder,
        owner: diagram.owner ?? '',
        lanes: derived.lanes,
        steps: loadedSteps,
      }),
    )
    setIsFlowchartCleared(false)
    setNotice({ type: 'success', message: `Loaded "${diagram.title}".` })
  }

  function startNewProcess() {
    if (
      hasUnsavedChanges &&
      !window.confirm('You have unsaved changes. Are you sure you want to start a new process?')
    ) {
      return
    }

    resetWorkspace()
  }

  async function handleDelete() {
    if (!currentId || !supabase) return

    if (!window.confirm('Are you sure you want to delete this flowchart? This cannot be undone.')) {
      return
    }

    setIsDeleting(true)
    setNotice(null)
    try {
      await deleteProcessDiagram(supabase, currentId)

      setSavedDiagrams((diagrams) =>
        diagrams.filter((diagram) => String(diagram.id) !== currentId),
      )
      resetWorkspace()
      setNotice({ type: 'success', message: 'Flowchart deleted.' })
    } catch (error) {
      setNotice({ type: 'error', message: `Could not delete flowchart: ${getErrorMessage(error)}` })
    } finally {
      setIsDeleting(false)
    }
  }

  const documentStatus = hasUnsavedChanges
    ? 'Unsaved Changes'
    : currentId
      ? 'Saved'
      : 'New Diagram'

  if (isAuthLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="flex items-center gap-3 text-sm text-slate-300" role="status">
          <span className="size-4 animate-spin rounded-full border-2 border-slate-600 border-t-cyan-400" />
          Restoring your session...
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-5 py-12 text-slate-900">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-40 -top-40 size-[520px] rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="absolute -bottom-48 -right-32 size-[560px] rounded-full bg-blue-600/15 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.045)_1px,transparent_1px)] bg-[size:48px_48px]" />
        </div>
        <section className="relative w-full max-w-[440px] rounded-2xl border border-white/70 bg-white p-8 shadow-[0_32px_100px_-40px_rgba(0,0,0,0.8)] sm:p-10">
          <div className="mb-8 flex size-12 items-center justify-center rounded-xl bg-slate-950 text-cyan-300 shadow-lg shadow-slate-900/15">
            <Workflow aria-hidden="true" size={23} />
          </div>
          <p className="mb-3 text-lg font-semibold tracking-tight text-slate-900">NF Flowchart Studio</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            Sign in
          </h1>

          <form className="mt-8 space-y-5" onSubmit={handleSignIn}>
            <label className="block text-sm font-medium text-slate-700">
              Email address
              <span className="relative mt-2 block">
                <Mail aria-hidden="true" size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  className="h-12 w-full rounded-lg border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-cyan-600 focus:bg-white focus:ring-4 focus:ring-cyan-600/10"
                />
              </span>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Password
              <span className="relative mt-2 block">
                <LockKeyhole aria-hidden="true" size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  className="h-12 w-full rounded-lg border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-cyan-600 focus:bg-white focus:ring-4 focus:ring-cyan-600/10"
                />
              </span>
            </label>
            {authError && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm leading-5 text-rose-700" role="alert">
                {authError}
              </p>
            )}
            {!isSupabaseConfigured && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-5 text-amber-800" role="status">
                Sign-in is unavailable until VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are configured.
              </p>
            )}
            <button
              type="submit"
              disabled={!isSupabaseConfigured || isSigningIn}
              className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white shadow-lg shadow-slate-950/10 transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-600/20 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isSigningIn ? 'Signing in...' : 'Sign In'}
              {!isSigningIn && <ArrowRight aria-hidden="true" size={17} className="transition-transform group-hover:translate-x-0.5" />}
            </button>
          </form>
          <p className="mt-8 border-t border-slate-100 pt-5 text-center text-xs text-slate-400">
            Secure access to your process workspace
          </p>
        </section>
      </main>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      {authError && (
        <p className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-center text-sm text-rose-800" role="alert">
          {authError}
        </p>
      )}
      <div className="print-hide border-b border-slate-800 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <Workflow aria-hidden="true" size={18} className="shrink-0 text-cyan-300" />
            <span className="truncate text-base font-semibold tracking-wide">NF Flowchart Studio</span>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <span className="max-w-[145px] truncate text-xs text-slate-300 sm:max-w-[240px] sm:text-sm" title={user.email}>
              {user.email}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-700 px-3 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-wait disabled:opacity-60"
            >
              <LogOut aria-hidden="true" size={15} />
              {isSigningOut ? 'Signing out...' : 'Sign Out'}
            </button>
          </div>
        </div>
      </div>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                NF Flowchart Studio
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Automated swimlane flowchart generator
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap items-end gap-3">
              <label className="block min-w-[220px] flex-1 text-xs font-medium text-slate-600">
                <span className="flex min-h-5 items-center gap-2">
                  Process Title
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      documentStatus === 'Saved'
                        ? 'bg-emerald-50 text-emerald-700'
                        : documentStatus === 'Unsaved Changes'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                    role="status"
                    aria-label={`Document status: ${documentStatus}`}
                  >
                    {documentStatus === 'Saved' ? (
                      <Check aria-hidden="true" size={12} />
                    ) : documentStatus === 'Unsaved Changes' ? (
                      <Circle aria-hidden="true" className="fill-current" size={8} />
                    ) : null}
                    {documentStatus}
                  </span>
                </span>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Customer Onboarding Flow"
                  className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />
              </label>
              <label className="block w-[180px] text-xs font-medium text-slate-600">
                <span className="flex min-h-5 items-center">Folder</span>
                <input
                  type="text"
                  list="folder-options"
                  value={folder}
                  onChange={(event) => setFolder(event.target.value)}
                  placeholder={defaultFolder}
                  className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />
                <datalist id="folder-options">
                  {folderNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>
              <label className="block w-[200px] text-xs font-medium text-slate-600">
                <span className="flex min-h-5 items-center gap-2">
                  Owner unit
                  {!owner.trim() && (
                    <span className="text-[11px] font-medium text-amber-700">not set</span>
                  )}
                </span>
                <input
                  type="text"
                  list="owner-options"
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                  placeholder="e.g. Zakat Unit"
                  className={`mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-2 focus:ring-sky-100 ${
                    owner.trim() ? 'border-slate-300 focus:border-sky-500' : 'border-amber-300 focus:border-amber-500'
                  }`}
                />
                <datalist id="owner-options">
                  {ownerNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveToDatabase}
                  disabled={!isSupabaseConfigured || isSaving || isDeleting}
                  className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Save aria-hidden="true" size={16} />
                  {isSaving ? 'Saving...' : currentId ? 'Save Changes' : 'Save'}
                </button>
                {currentId !== null && (
                  <button
                    type="button"
                    onClick={handleSaveAsNew}
                    disabled={!isSupabaseConfigured || isSaving || isDeleting}
                    className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    Save as Copy
                  </button>
                )}
                <button
                  type="button"
                  onClick={startNewProcess}
                  disabled={isSaving || isDeleting}
                  className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus aria-hidden="true" size={16} />
                  New
                </button>
                {currentId !== null && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={!isSupabaseConfigured || isSaving || isDeleting}
                    className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-rose-200 bg-white px-3 text-sm font-medium text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 aria-hidden="true" size={15} />
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </button>
                )}
                <div className="relative h-10 w-[220px]">
                  <FolderOpen
                    aria-hidden="true"
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <select
                    aria-label="Load Flowchart"
                    value={currentId ?? ''}
                    onChange={loadProcess}
                    disabled={!isSupabaseConfigured || isLoadingDiagrams || savedDiagrams.length === 0}
                    className="h-10 w-full appearance-none rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="">
                      {isLoadingDiagrams
                        ? 'Loading saved flowcharts...'
                        : savedDiagrams.length
                          ? 'Load Flowchart'
                          : 'No saved flowcharts'}
                    </option>
                    {folderNames.map((name) => {
                      const items = savedDiagrams.filter((diagram) => diagram.folder === name)
                      if (items.length === 0) return null
                      return (
                        <optgroup key={name} label={name}>
                          {items.map((diagram) => (
                            <option key={diagram.id} value={String(diagram.id)}>
                              {diagram.title}
                            </option>
                          ))}
                        </optgroup>
                      )
                    })}
                  </select>
                </div>
              </div>
            </div>
          </div>
          {!isSupabaseConfigured && (
            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
              Offline mode: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable saving and loading. Your current flowchart remains editable in this session.
            </p>
          )}
          {notice && (
            <p
              className={`mt-4 rounded-md border px-3 py-2 text-sm ${notice.type === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
              role={notice.type === 'error' ? 'alert' : 'status'}
            >
              {notice.message}
            </p>
          )}
          {validationIssues.length > 0 && (
            <section
              className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950"
              aria-label="BPMN validation warnings"
              role="status"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">
                  {validationIssues.length} validation {validationIssues.length === 1 ? 'warning' : 'warnings'}
                </span>
                <span className="text-sm font-medium">Review the process before publishing.</span>
              </div>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-900">
                {validationIssues.map((issue) => (
                  <li key={issue.code}>{issue.message}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </header>
      <section
        className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8"
        aria-label="Flowchart lanes"
      >
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-800">Lanes</h2>
          {lanes.map((lane, index) => (
            <div key={lane.id} className="flex items-center gap-2">
              <input
                type="text"
                aria-label={`Lane name ${index + 1}`}
                value={lane.name}
                onChange={(event) => {
                  const name = event.target.value
                  setLanes((currentLanes) =>
                    currentLanes.map((currentLane) =>
                      currentLane.id === lane.id ? { ...currentLane, name } : currentLane),
                  )
                  setSteps((currentSteps) =>
                    currentSteps.map((step) =>
                      step.laneId === lane.id ? { ...step, department: name } : step),
                  )
                }}
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />
              {lane.pinned && (
                <span className="text-xs font-medium text-sky-700">Pinned</span>
              )}
              <button
                type="button"
                aria-label={`Move lane ${lane.name} up`}
                disabled={index === 0}
                onClick={() => {
                  setLanes((currentLanes) => {
                    if (index === 0 || currentLanes[index - 1]?.pinned) return currentLanes
                    const reordered = [...currentLanes]
                    ;[reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]]
                    return reordered
                  })
                }}
                className="rounded-md border border-slate-300 p-2 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowUp aria-hidden="true" size={16} />
              </button>
              <button
                type="button"
                aria-label={`Move lane ${lane.name} down`}
                disabled={index === lanes.length - 1 || Boolean(lane.pinned)}
                onClick={() => {
                  setLanes((currentLanes) => {
                    if (index >= currentLanes.length - 1 || currentLanes[index].pinned) {
                      return currentLanes
                    }
                    const reordered = [...currentLanes]
                    ;[reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]]
                    return reordered
                  })
                }}
                className="rounded-md border border-slate-300 p-2 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowDown aria-hidden="true" size={16} />
              </button>
              <button
                type="button"
                aria-label={lane.pinned ? 'Unpin lane' : 'Pin lane'}
                title={lane.pinned ? 'Unpin lane' : 'Pin lane'}
                onClick={() => {
                  setLanes((currentLanes) => {
                    const updatedLanes = setPinnedLane(currentLanes, lane.id)
                    const pinnedLane = updatedLanes.find((currentLane) => currentLane.pinned)
                    if (!pinnedLane) return updatedLanes
                    return [
                      pinnedLane,
                      ...updatedLanes.filter((currentLane) => currentLane.id !== pinnedLane.id),
                    ]
                  })
                }}
                className={`inline-flex size-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 ${
                  lane.pinned ? 'border-sky-500 bg-sky-50 text-sky-700' : ''
                }`}
              >
                <Pin aria-hidden="true" size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <StepMatrix
          key={matrixKey}
          steps={steps}
          onStepsChange={setSteps}
          onGenerate={updatePreview}
        />
        <FlowCanvas
          steps={isFlowchartCleared ? [] : previewSteps}
          lanes={lanes}
          processTitle={previewTitle}
          folder={folder}
          owner={owner}
        />
      </main>
    </div>
  )
}

export default App