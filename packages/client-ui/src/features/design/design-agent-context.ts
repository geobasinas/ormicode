export type DesignAgentContext = {
  slug: string;
  name: string;
  revision: number;
  frame?: { id: string; name: string };
};

export function designTaskContext(board: DesignAgentContext): string {
  const frame = board.frame ? ` Selected frame: ${JSON.stringify(board.frame.name)} (id ${board.frame.id}).` : '';
  return `Design board: ${JSON.stringify(board.name)} (slug ${board.slug}; revision ${board.revision} when this task was sent).${frame} Read the latest board with ormi_design_get before applying changes.`;
}
