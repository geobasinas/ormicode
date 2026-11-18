export function usage(code: number): never {
  console.log(`usage:
  ormi agent smoke <vendor> [--transport sdk|cli|acp] [--repo <dir>] [--home <dir>] [--kill] [--approve <optionId>] [--keep]
  ormi agent smoke <vendor> --command <acp-cmd> [--args "..."]   (third-party ACP agent)
  ormi daemon                                     run the supervisor in the foreground
  ormi status                                     daemon.status
  ormi session start <vendor> [--transport t]     start a session, prints its id
  ormi session list [--archived]
  ormi session get <id>
  ormi session prompt <id> <text>
  ormi session steer <id> <text>                  steer mid-turn
  ormi session abort|pause|resume|retry|delete|archive <id>
  ormi session decide <id> <requestId> <optionId>
  ormi session answer <id> <requestId> '<json>'
  ormi session set <id> model|effort|mode|option <value>
  ormi session note <id> <title> [body]
  ormi session notes <id>
  ormi session tail <id>                          stream live + replayed events
  ormi checkpoint list <id> | diff <id> <from> [to] | restore <id> <cp> [--conversation] | fork <id> <cp> [--branch b]
  ormi run <vendor> [--transport t] [agent args]   start a session and attach (Ctrl+] detaches)
  ormi attach <id>                                reattach a running session
  ormi relay register --account <a> [--relay <url>] [--secret <s>]   register this hub
  ormi pair                                       mint a pairing code on the hub
  ormi connect <relay-url> --account <a> --code <c> [--name <n>]   pair this device to a remote hub
  ormi devices [list|rename <id> <name>|revoke <id> <name>]        manage paired devices`);
  process.exit(code);
}

export function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
