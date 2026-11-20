export function permissionEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  let config: unknown;
  try { config = JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? '{}'); } catch { throw new Error('Invalid OPENCODE_CONFIG_CONTENT JSON'); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('OPENCODE_CONFIG_CONTENT must be an object');
  return { ...env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...config, permission: { '*': 'ask' } }) };
}
