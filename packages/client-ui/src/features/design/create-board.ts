export function newBoardIdentity(name: string, boards: readonly { slug: string }[]) {
  const title = name.trim();
  if (!title) throw new Error('Enter a board name.');
  const base = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'board';
  const used = new Set(boards.map(board => board.slug));
  let slug = base;
  for (let suffix = 2; used.has(slug); suffix++) slug = `${base.slice(0, 47 - String(suffix).length)}-${suffix}`;
  return { name: title, slug };
}
