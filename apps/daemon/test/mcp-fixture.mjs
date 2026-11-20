import { McpCredentials } from '../src/mcp-auth.ts';

export class TestMcpCredentials extends McpCredentials {
  proofs = new Map();
  issue(session) {
    const token = super.issue(session);
    this.proofs.set(session, { session, token });
    return token;
  }
  proof(session) {
    if (!this.proofs.has(session)) throw new Error('test session has no MCP credential');
    return this.proofs.get(session);
  }
}
