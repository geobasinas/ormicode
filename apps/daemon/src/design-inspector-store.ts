import { DESIGN_TOKEN_LIMIT, type DesignDocument, type DesignToken } from '@ormicode/protocol';

export function setDesignToken(document: DesignDocument, token: DesignToken, invalid: (message: string) => never): void {
  const tokens = document.tokens ??= [];
  const index = tokens.findIndex(existing => existing.name === token.name);
  if (index === -1) {
    if (tokens.length >= DESIGN_TOKEN_LIMIT) invalid('At most 32 design tokens are supported per board');
    tokens.push(token);
    return;
  }
  if (tokens[index].kind !== token.kind) invalid('The kind of an existing design token cannot change');
  tokens[index] = token;
}
