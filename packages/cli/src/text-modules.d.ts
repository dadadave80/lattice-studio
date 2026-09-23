// Creation code files the CLI bundles as text (`import code from "…/Lattice.creation.hex" with { type: "text" }`).
declare module "*.hex" {
  const text: string;
  export default text;
}
