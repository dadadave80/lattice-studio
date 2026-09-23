/**
 * The recipe × path table each suite prints when it finishes, so a run's log says what ran and how it ended
 * (Done when: "the report lists each recipe × path result").
 */
import { scrub } from "./scrub";

export type Row = { recipe: string; path: string; result: string };

export class ResultTable {
  private readonly rows: Row[] = [];

  constructor(private readonly title: string) {}

  record(recipe: string, path: string, result: string): void {
    const existing = this.rows.find((row) => row.recipe === recipe && row.path === path);
    if (existing) existing.result = scrub(result);
    else this.rows.push({ recipe, path, result: scrub(result) });
  }

  /** Records "fail: <reason>" when `fn` throws, then rethrows, so a failed case still shows in the table. */
  async run<T>(recipe: string, path: string, fn: () => Promise<T>, ok: (value: T) => string): Promise<T> {
    try {
      const value = await fn();
      this.record(recipe, path, ok(value));
      return value;
    } catch (error) {
      this.record(recipe, path, `fail: ${scrub(error instanceof Error ? error.message : String(error)).split("\n")[0]?.slice(0, 160)}`);
      throw error;
    }
  }

  text(): string {
    if (this.rows.length === 0) return `${this.title}: nothing ran.`;
    const width = (key: keyof Row, head: string) => Math.max(head.length, ...this.rows.map((row) => row[key].length));
    const [r, p] = [width("recipe", "Recipe"), width("path", "Path")];
    const line = (row: Row) => `  ${row.recipe.padEnd(r)}  ${row.path.padEnd(p)}  ${row.result}`;
    return [`${this.title}:`, line({ recipe: "Recipe", path: "Path", result: "Result" }), ...this.rows.map(line)].join("\n");
  }

  print(): void {
    console.log(this.text());
  }
}
