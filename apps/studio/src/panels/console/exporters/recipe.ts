/**
 * The recipe every export writes (spec L212: the recipe's `name` is "written on export and in share links").
 * `project.rename` changes only `project.name` (S1's `renameProject`), so every exporter stamps it onto the
 * recipe here rather than trusting whatever `project.recipe.name` last held (a template's name, or nothing).
 * `name` sits outside the recipe hash (spec L283: hashed without `$schema`, `name`, `template` and unknown
 * fields), so stamping it never changes the hash an export reports. A blank project name drops the field
 * rather than writing `"name": ""` into recipe.json: `Recipe["name"]` is optional, and every display already
 * falls back the same way for `undefined` and `""` ("Untitled diamond", "the diamond").
 */
import type { Project, Recipe } from "@lattice-studio/core";

export function exportRecipe(project: Project): Recipe {
  if (project.name === "") {
    const { name: _blank, ...rest } = project.recipe;
    return rest;
  }
  return { ...project.recipe, name: project.name };
}
