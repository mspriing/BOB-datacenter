import type { EstimateOutput } from '../types/schema.ts'

interface RecommendationCardProps {
  output: EstimateOutput
}

/**
 * Plain-English recommendation paragraph + flip sentence.
 * Narrative will be LLM-generated once watsonx is wired in.
 */
export function RecommendationCard({ output }: RecommendationCardProps) {
  return (
    <div className="border border-gray-300 rounded-md p-4 bg-white space-y-3">
      <h3 className="text-base font-semibold text-gray-800">Recommendation</h3>
      <p className="text-sm text-gray-700 leading-relaxed">{output.narrative}</p>
      <div className="mt-3 border-t pt-3">
        <p className="text-xs font-medium text-orange-700">⚠️ {output.flip_sentence}</p>
      </div>
    </div>
  )
}
