export type PreviewConsoleRequest = { generation: number; after?: number };

export class PreviewConsoleCursor {
  private generation = 0;
  private after: number | undefined;

  reset(): void {
    this.generation += 1;
    this.after = undefined;
  }

  beginRequest(): PreviewConsoleRequest {
    return { generation: this.generation, ...(this.after === undefined ? {} : { after: this.after }) };
  }

  commit(request: PreviewConsoleRequest, next: number): boolean {
    if (request.generation !== this.generation) return false;
    this.after = next;
    return true;
  }
}
