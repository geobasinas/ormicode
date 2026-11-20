export function questionAnswers(questions: { question: string }[], picked: Record<string, string[]>): Record<string, string> | undefined {
  if (!questions.length || questions.some(q => !Object.hasOwn(picked, q.question) || !picked[q.question]?.join(', ').trim())) return;
  return Object.fromEntries(questions.map(q => [q.question, picked[q.question]!.join(', ')]));
}
