import * as z from 'zod/mini';
import { designRequests } from '@ormicode/protocol';

const descriptions = {
  'design.list': 'List design boards in the current session’s working tree.',
  'design.get': 'Read the board, its editable frame HTML and CSS, feedback, and retained revision summaries. Read before mutating.',
  'design.create': 'Create a repository-backed design board in the current session’s working tree.',
  'design.update': 'Apply one atomic batch of design operations for pages, guides, frames, tokens, and feedback. For clickable prototypes, set data-ormi-prototype on elements in frame HTML (frame:<frameId>, overlay:<frameId>, back, or close-overlay) and use page.start to set the entry frame. Frame approval is reserved for users. Use the current board revision as expectedRevision. On design.conflict, read the board again and reconcile the changes before submitting a new batch.',
  'design.frameVersions': 'Read retained content versions of one design frame.',
  'design.mentionable': 'List sessions that can be mentioned in design feedback in the current working tree.',
  'design.history': 'List retained board revision summaries.',
  'design.activity': 'List recent board edits and their recorded originating sessions in the current working tree.',
  'design.restore': 'Restore a retained board revision as a new revision. Set expectedRevision to the current board revision.',
} satisfies Partial<Record<keyof typeof designRequests, string>>;

export function designMcpTools() {
  return (Object.keys(descriptions) as (keyof typeof descriptions)[]).map(method => {
    // Routing is determined by the MCP server's owning session, never by tool arguments.
    const { session: _session, ...fields } = designRequests[method].shape;
    const inputSchema = z.toJSONSchema(z.strictObject(fields), { io: 'input' });
    return {
      name: 'ormi_' + method.replace('.', '_').replace(/[A-Z]/g, letter => '_' + letter.toLowerCase()),
      description: descriptions[method],
      inputSchema,
    };
  });
}
