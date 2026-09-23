import type { BlankDiamondFn, LoadTemplateFn, TemplateListFn } from "../model/api";
import { notImplemented } from "../model/wp";

export const templateList: TemplateListFn = () => notImplemented("C5a", "templateList");
export const loadTemplate: LoadTemplateFn = () => notImplemented("C5a", "loadTemplate");
export const blankDiamond: BlankDiamondFn = () => notImplemented("C5a", "blankDiamond");
