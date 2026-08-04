// AI plan generation dialog: prompt → Anthropic API → robust
// normalize pipeline → importPlan. The API key lives ONLY in
// this browser's localStorage — never inside plan files.
import React, { useState } from 'react'
import { usePlanStore } from '../store/planStore'
import { requestAiPlan, aiTextToPlan } from '../ai/planGen'

const KEY_STORAGE = 'planforge_api_key'

export default function AiGenerate({ onClose }) {
  const importPlan = usePlanStore((s) => s.importPlan)
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(KEY_STORAGE) || '')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [warnings, setWarnings] = useState(null)

  const generate = async () => {
    if (!apiKey.trim() || !prompt.trim() || busy) return
    localStorage.setItem(KEY_STORAGE, apiKey.trim())
    setBusy(true)
    setError(null)
    setWarnings(null)
    try {
      const text = await requestAiPlan({ apiKey: apiKey.trim(), prompt: prompt.trim(), model })
      const result = aiTextToPlan(text)
      if (result.error) {
        setError(`The reply couldn't be turned into a plan: ${result.error}`)
      } else {
        importPlan(result.plan)
        if (result.warnings.length) {
          setWarnings(result.warnings)
        } else {
          onClose()
        }
      }
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal glass" role="dialog" aria-label="Generate plan with AI">
        <h2>✨ Generate a plan with AI</h2>
        {warnings ? (
          <>
            <p className="hint">Plan imported. A few things were adjusted:</p>
            <ul className="ai-warnings">
              {warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
              {warnings.length > 8 && <li>…and {warnings.length - 8} more</li>}
            </ul>
            <div className="btn-row">
              <button className="primary" onClick={onClose}>Open the plan</button>
            </div>
          </>
        ) : (
          <>
            <label className="field">
              Describe the house
              <textarea
                rows={4}
                value={prompt}
                autoFocus
                placeholder="e.g. A single-storey 3-bedroom house around 10×12m with an open-plan kitchen/living area facing south, two bathrooms, and a small office."
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate() }}
              />
            </label>
            <label className="field">
              Anthropic API key
              <input type="password" value={apiKey}
                placeholder="sk-ant-…"
                onChange={(e) => setApiKey(e.target.value)} />
            </label>
            <div className="field-pair">
              <label className="field">
                Model
                <select value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                  <option value="claude-opus-4-8">Claude Opus 4.8</option>
                  <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                </select>
              </label>
              <div className="field ai-go">
                <button className="primary" disabled={busy || !apiKey.trim() || !prompt.trim()}
                  onClick={generate}>
                  {busy ? 'Designing…' : 'Generate (⌘↵)'}
                </button>
              </div>
            </div>
            {error && <p className="clearance-warning">{error}</p>}
            <p className="hint">
              Your key is stored only in this browser and sent directly to Anthropic —
              it never touches any other server or your plan files. Generation costs
              standard API usage.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
