// Supabase Edge Runtime provides this global at execution time. The Deno type package
// does not currently declare it for this function, so describe the small surface used here.
declare namespace Supabase {
  namespace ai {
    class Session {
      constructor(model: string);
      run(input: string, options?: Record<string, unknown>): Promise<unknown>;
    }
  }
}
