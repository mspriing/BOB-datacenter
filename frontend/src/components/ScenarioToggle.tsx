import type { Scenario } from '../types/schema.ts'

interface ScenarioToggleProps {
  scenario: Scenario
  onChange: (s: Scenario) => void
}

const OPTIONS: Array<{ value: Scenario; label: string; sub: string }> = [
  { value: 'low',  label: 'Low',  sub: 'optimistic' },
  { value: 'base', label: 'Base', sub: 'expected'   },
  { value: 'high', label: 'High', sub: 'stress'     },
]

export function ScenarioToggle({ scenario, onChange }: ScenarioToggleProps) {
  return (
    <div className="flex items-center gap-0 border border-ibm-cool-30 divide-x divide-ibm-cool-30">
      {OPTIONS.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-4 py-2 text-sm transition-colors flex flex-col items-center leading-tight min-w-[72px] ${
            scenario === opt.value
              ? 'bg-ibm-blue text-white'
              : 'bg-white text-ibm-cool-70 hover:bg-ibm-cool-10'
          }`}
        >
          <span className="font-semibold">{opt.label}</span>
          <span className={`text-xs ${scenario === opt.value ? 'text-ibm-blue-light/80' : 'text-ibm-cool-40'}`}>
            {opt.sub}
          </span>
        </button>
      ))}
    </div>
  )
}
