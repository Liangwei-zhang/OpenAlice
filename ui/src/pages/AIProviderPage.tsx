import { useState, useEffect, useRef } from 'react'
import { api, type Profile, type AIBackend, type Preset, type JsonSchemaProperty } from '../api'
import { SaveIndicator } from '../components/SaveIndicator'
import { Field, inputClass } from '../components/form'
import type { SaveStatus } from '../hooks/useAutoSave'
import { PageHeader } from '../components/PageHeader'
import { PageLoading } from '../components/StateViews'

// ==================== Icons ====================

const BACKEND_ICONS: Record<AIBackend, React.ReactNode> = {
  'agent-sdk': <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 0 1 4 4v1a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V6a4 4 0 0 1 4-4z" /><path d="M8 8v2a4 4 0 0 0 8 0V8" /><path d="M12 14v4" /><path d="M8 22h8" /><circle cx="9" cy="5.5" r="0.5" fill="currentColor" stroke="none" /><circle cx="15" cy="5.5" r="0.5" fill="currentColor" stroke="none" /></svg>,
  'codex': <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /><line x1="14" y1="4" x2="10" y2="20" /></svg>,
  'vercel-ai-sdk': <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
}

// ==================== Main Page ====================

export function AIProviderPage() {
  const [profiles, setProfiles] = useState<Record<string, Profile> | null>(null)
  const [activeProfile, setActiveProfile] = useState('')
  const [presets, setPresets] = useState<Preset[]>([])
  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    api.config.getProfiles().then(({ profiles: p, activeProfile: a }) => {
      setProfiles(p)
      setActiveProfile(a)
    }).catch(() => {})
    api.config.getPresets().then(({ presets: p }) => setPresets(p)).catch(() => {})
  }, [])

  const handleSetActive = async (slug: string) => {
    try { await api.config.setActiveProfile(slug); setActiveProfile(slug) } catch {}
  }

  const handleDelete = async (slug: string) => {
    if (!profiles) return
    try {
      await api.config.deleteProfile(slug)
      const updated = { ...profiles }; delete updated[slug]
      setProfiles(updated); setEditingSlug(null)
    } catch {}
  }

  const handleCreateSave = async (slug: string, profile: Profile) => {
    await api.config.createProfile(slug, profile)
    setProfiles((p) => p ? { ...p, [slug]: profile } : p)
    setShowCreate(false)
  }

  const handleProfileUpdate = async (slug: string, profile: Profile) => {
    await api.config.updateProfile(slug, profile)
    setProfiles((p) => p ? { ...p, [slug]: profile } : p)
  }

  if (!profiles) return <div className="flex flex-col flex-1 min-h-0"><PageHeader title="AI Provider" description="Manage AI provider profiles." /><PageLoading /></div>

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title="AI Provider" description="Manage AI provider profiles." />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
        <div className="max-w-[640px] mx-auto space-y-3">
          {Object.entries(profiles).map(([slug, profile]) => {
            const isActive = slug === activeProfile
            return (
              <div key={slug} className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${isActive ? 'border-accent bg-accent-dim/20' : 'border-border bg-bg'}`}>
                <div className="text-text-muted">{BACKEND_ICONS[profile.backend]}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-text truncate">{slug}</span>
                    {isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-medium shrink-0">Active</span>}
                  </div>
                  <p className="text-[11px] text-text-muted truncate">{profile.model || 'Auto (subscription plan)'}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!isActive && <button onClick={() => handleSetActive(slug)} className="text-[11px] px-2 py-1 rounded-md border border-border text-text-muted hover:text-accent hover:border-accent transition-colors">Set Default</button>}
                  <button onClick={() => setEditingSlug(slug)} className="text-[11px] px-2 py-1 rounded-md border border-border text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors">Edit</button>
                </div>
              </div>
            )
          })}
          <button onClick={() => setShowCreate(true)} className="w-full p-4 rounded-xl border-2 border-dashed border-border text-text-muted hover:border-accent/50 hover:text-accent transition-all text-[13px] font-medium">+ New Profile</button>
        </div>
      </div>

      {editingSlug && profiles[editingSlug] && (
        <ProfileEditModal slug={editingSlug} profile={profiles[editingSlug]} presets={presets}
          isActive={editingSlug === activeProfile}
          onSave={(p) => handleProfileUpdate(editingSlug, p)}
          onDelete={() => handleDelete(editingSlug)}
          onClose={() => setEditingSlug(null)} />
      )}
      {showCreate && <ProfileCreateModal presets={presets} onSave={handleCreateSave} onClose={() => setShowCreate(false)} />}
    </div>
  )
}

// ==================== Modal Shell ====================

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-bg border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-[15px] font-semibold text-text">{title}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}

// ==================== Edit Modal ====================

function ProfileEditModal({ slug, profile, presets, isActive, onSave, onDelete, onClose }: {
  slug: string; profile: Profile; presets: Preset[]; isActive: boolean
  onSave: (profile: Profile) => Promise<void>; onDelete: () => void; onClose: () => void
}) {
  const preset = findPresetForProfile(profile, presets)
  const [formData, setFormData] = useState<Record<string, string>>(() => profileToFormData(profile))
  const [status, setStatus] = useState<SaveStatus>('idle')
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setFormData(profileToFormData(profile)); setStatus('idle') }, [slug, profile])
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current) }, [])

  const handleSave = async () => {
    setStatus('saving')
    try {
      const merged = mergeFormWithConsts(formData, preset?.schema)
      await onSave(merged as unknown as Profile)
      setStatus('saved')
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => { setStatus('idle'); onClose() }, 1000)
    } catch { setStatus('error') }
  }

  return (
    <Modal title={`Edit: ${slug}`} onClose={onClose}>
      <div className="space-y-3">
        {preset?.hint && <p className="text-[11px] text-text-muted bg-bg-tertiary rounded-lg p-3 leading-relaxed">{preset.hint}</p>}
        <SchemaForm schema={preset?.schema} formData={formData} onChange={setFormData} existingProfile={profile} />
        <div className="flex items-center gap-2 pt-2 border-t border-border mt-4">
          <button onClick={handleSave} className="btn-primary">Save</button>
          <SaveIndicator status={status} onRetry={handleSave} />
          <div className="flex-1" />
          {!isActive && <button onClick={onDelete} className="text-[12px] text-red hover:underline">Delete</button>}
        </div>
      </div>
    </Modal>
  )
}

// ==================== Create Modal ====================

function ProfileCreateModal({ presets, onSave, onClose }: {
  presets: Preset[]; onSave: (slug: string, profile: Profile) => Promise<void>; onClose: () => void
}) {
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null)
  const [name, setName] = useState('')
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selectPreset = (preset: Preset) => {
    setSelectedPreset(preset)
    setName(preset.defaultName)
    setFormData(extractDefaults(preset.schema))
    setError('')
  }

  const handleCreate = async () => {
    if (!selectedPreset) return
    const trimmedName = name.trim()
    if (!trimmedName) { setError('Profile name is required'); return }
    // Check required fields from schema
    const required = (selectedPreset.schema.required as string[] | undefined) ?? []
    for (const field of required) {
      const prop = (selectedPreset.schema.properties as Record<string, JsonSchemaProperty>)?.[field]
      if (prop?.const !== undefined) continue // const fields are auto-filled
      if (!formData[field]?.trim()) { setError(`${prop?.title ?? field} is required`); return }
    }
    setSaving(true); setError('')
    try {
      const merged = mergeFormWithConsts(formData, selectedPreset.schema)
      await onSave(trimmedName, merged as unknown as Profile)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    } finally { setSaving(false) }
  }

  const officialPresets = presets.filter(p => p.category === 'official')
  const thirdPartyPresets = presets.filter(p => p.category === 'third-party')
  const customPreset = presets.find(p => p.category === 'custom')

  return (
    <Modal title={selectedPreset ? `New: ${selectedPreset.label}` : 'New Profile'} onClose={onClose}>
      {!selectedPreset ? (
        <div className="space-y-4">
          {officialPresets.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-text-muted mb-2 uppercase tracking-wider">Official</p>
              <div className="grid grid-cols-2 gap-2">
                {officialPresets.map((p) => (
                  <button key={p.id} onClick={() => selectPreset(p)} className="flex items-start gap-2.5 p-3 rounded-lg border border-border bg-bg hover:bg-bg-tertiary hover:border-accent/40 transition-all text-left">
                    <div className="text-text-muted mt-0.5">{BACKEND_ICONS[getSchemaConst(p.schema, 'backend') as AIBackend ?? 'vercel-ai-sdk']}</div>
                    <div>
                      <p className="text-[12px] font-medium text-text">{p.label}</p>
                      <p className="text-[10px] text-text-muted mt-0.5 leading-snug">{p.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          {thirdPartyPresets.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-text-muted mb-2 uppercase tracking-wider">Third Party</p>
              <div className="grid grid-cols-2 gap-2">
                {thirdPartyPresets.map((p) => (
                  <button key={p.id} onClick={() => selectPreset(p)} className="flex items-start gap-2.5 p-3 rounded-lg border border-border bg-bg hover:bg-bg-tertiary hover:border-accent/40 transition-all text-left">
                    <div className="text-text-muted mt-0.5">{BACKEND_ICONS[getSchemaConst(p.schema, 'backend') as AIBackend ?? 'vercel-ai-sdk']}</div>
                    <div>
                      <p className="text-[12px] font-medium text-text">{p.label}</p>
                      <p className="text-[10px] text-text-muted mt-0.5 leading-snug">{p.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          {customPreset && (
            <button onClick={() => selectPreset(customPreset)} className="w-full p-3 rounded-lg border border-dashed border-border hover:border-accent/40 hover:bg-bg-tertiary transition-all text-left">
              <p className="text-[12px] font-medium text-text">+ Custom</p>
              <p className="text-[10px] text-text-muted mt-0.5">{customPreset.description}</p>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {selectedPreset.hint && <p className="text-[11px] text-text-muted bg-bg-tertiary rounded-lg p-3 leading-relaxed">{selectedPreset.hint}</p>}
          <Field label="Profile Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My Claude" autoFocus />
          </Field>
          <SchemaForm schema={selectedPreset.schema} formData={formData} onChange={setFormData} />
          {error && <p className="text-[12px] text-red">{error}</p>}
          <div className="flex items-center gap-2 pt-2 border-t border-border mt-4">
            <button onClick={handleCreate} disabled={saving} className="btn-primary">{saving ? 'Creating...' : 'Create'}</button>
            <button onClick={() => setSelectedPreset(null)} className="btn-secondary">Back</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ==================== Schema-driven Form Renderer ====================

function SchemaForm({ schema, formData, onChange, existingProfile }: {
  schema?: Preset['schema']
  formData: Record<string, string>
  onChange: (data: Record<string, string>) => void
  existingProfile?: Profile
}) {
  if (!schema?.properties) return null
  const props = schema.properties as Record<string, JsonSchemaProperty>
  const required = new Set(schema.required as string[] ?? [])

  const setField = (key: string, value: string) => {
    onChange({ ...formData, [key]: value })
  }

  return (
    <>
      {Object.entries(props).map(([key, prop]) => {
        // const → hidden, value baked in
        if (prop.const !== undefined) return null

        const isRequired = required.has(key)
        const isPassword = !!prop.writeOnly
        const title = prop.title ?? key.charAt(0).toUpperCase() + key.slice(1)
        const label = isRequired ? title : `${title} (optional)`
        const value = formData[key] ?? ''
        const hasExisting = existingProfile && key === 'apiKey' && !!(existingProfile as unknown as Record<string, unknown>)[key]

        // oneOf → dropdown with labels
        if (prop.oneOf) {
          const showCustom = value === '__custom__'
          return (
            <Field key={key} label={label} description={prop.description}>
              <select className={inputClass} value={prop.oneOf.some(o => o.const === value) ? value : (value ? '__custom__' : '')}
                onChange={(e) => { setField(key, e.target.value === '__custom__' ? '' : e.target.value) }}>
                {prop.oneOf.map((opt) => <option key={opt.const} value={opt.const}>{opt.title}</option>)}
                <option value="__custom__">Custom...</option>
              </select>
              {showCustom && <input className={`${inputClass} mt-2`} value={formData[`${key}__custom`] ?? ''} onChange={(e) => { onChange({ ...formData, [key]: e.target.value, [`${key}__custom`]: e.target.value }) }} placeholder="Enter custom value" />}
            </Field>
          )
        }

        // enum → simple dropdown (no labels)
        if (prop.enum) {
          return (
            <Field key={key} label={label} description={prop.description}>
              <select className={inputClass} value={value} onChange={(e) => setField(key, e.target.value)}>
                {prop.enum.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
          )
        }

        // password field
        if (isPassword) {
          return (
            <Field key={key} label={label} description={prop.description}>
              <div className="relative">
                <input className={inputClass} type="password" value={value} onChange={(e) => setField(key, e.target.value)}
                  placeholder={hasExisting ? '(configured — leave empty to keep)' : 'Enter value'} />
                {hasExisting && !value && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-green">active</span>}
              </div>
            </Field>
          )
        }

        // default: text input
        return (
          <Field key={key} label={label} description={prop.description}>
            <input className={inputClass} value={value} onChange={(e) => setField(key, e.target.value)} placeholder={prop.default !== undefined ? String(prop.default) : ''} />
          </Field>
        )
      })}
    </>
  )
}

// ==================== Helpers ====================

/** Extract const value from a schema property. */
function getSchemaConst(schema: Preset['schema'], field: string): unknown {
  const props = schema?.properties as Record<string, JsonSchemaProperty> | undefined
  return props?.[field]?.const
}

/** Extract default values from schema. */
function extractDefaults(schema: Preset['schema']): Record<string, string> {
  const data: Record<string, string> = {}
  const props = schema?.properties as Record<string, JsonSchemaProperty> | undefined
  if (!props) return data
  for (const [key, prop] of Object.entries(props)) {
    if (prop.const !== undefined) continue // const fields handled at merge time
    if (prop.default !== undefined) data[key] = String(prop.default)
  }
  return data
}

/** Merge user form data with const values from schema. */
function mergeFormWithConsts(formData: Record<string, string>, schema?: Preset['schema']): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const props = schema?.properties as Record<string, JsonSchemaProperty> | undefined
  if (props) {
    for (const [key, prop] of Object.entries(props)) {
      if (prop.const !== undefined) {
        result[key] = prop.const
      }
    }
  }
  for (const [key, value] of Object.entries(formData)) {
    if (key.endsWith('__custom')) continue // internal custom field tracking
    if (value !== '' && value !== undefined) result[key] = value
  }
  return result
}

/** Convert an existing profile to form data (for editing). */
function profileToFormData(profile: Profile): Record<string, string> {
  const data: Record<string, string> = {}
  for (const [key, value] of Object.entries(profile)) {
    if (value !== undefined && value !== null) data[key] = String(value)
  }
  return data
}

/** Find the best matching preset for an existing profile. */
function findPresetForProfile(profile: Profile, presets: Preset[]): Preset | undefined {
  return presets.find(p => {
    const props = p.schema?.properties as Record<string, JsonSchemaProperty> | undefined
    if (!props) return false
    // Match by const fields (backend, loginMethod, provider, baseUrl)
    for (const [key, prop] of Object.entries(props)) {
      if (prop.const !== undefined && (profile as unknown as Record<string, unknown>)[key] !== prop.const) return false
    }
    return true
  }) ?? presets.find(p => p.category === 'custom')
}
