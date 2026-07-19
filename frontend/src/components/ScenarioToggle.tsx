import type { Scenario } from '../types/schema.ts'

interface ScenarioToggleProps {
  scenario: Scenario
  onChange: (s: Scenario) => void
}

/**
 * Three-button toggle: Low / Base / High scenario.
 */
export function ScenarioToggle({ scenario, onChange }: ScenarioToggleProps) {
  const options: Scenario[] = ['low', 'base', 'high']
  return (
    <div className="flex items-center gap-2 border border-gray-300 rounded-md p-1 bg-white w-fit">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`px-4 py-1 text-sm font-medium rounded transition ${
            scenario === opt
              ? 'bg-blue-600 text-white'
              : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
          }`}
          onClick={() => onChange(opt)}
        >
          {opt.charAt(0).toUpperCase() + opt.slice(1)}
        </button>
      ))}
    </div>
  )
}
