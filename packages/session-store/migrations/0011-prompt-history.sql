CREATE INDEX events_prompt_history ON events(ts DESC, seq DESC, session) WHERE kind = 'prompt';
