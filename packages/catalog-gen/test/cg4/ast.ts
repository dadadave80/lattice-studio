/**
 * Builders for solc AST fragments, so the init walk can be tested without a Lattice build. Each builder takes the
 * exact source text of the node and finds it in the file, so `src` byte ranges are real.
 */
import type { Artifact } from "../../src/artifacts";
import { type AstNode, makeUnit, type Unit, type UnitLoader } from "../../src/inits";

export class File {
  readonly bytes: Buffer;
  private nextId: number;
  constructor(
    readonly path: string,
    readonly source: string,
    idBase: number,
  ) {
    this.bytes = Buffer.from(source);
    this.nextId = idBase;
  }

  id(): number {
    return this.nextId++;
  }

  /** `start:length:0` of the `nth` occurrence (0-based) of `snippet`, in bytes. */
  src(snippet: string, nth = 0): string {
    let at = -1;
    for (let i = 0; i <= nth; i++) {
      at = this.bytes.indexOf(snippet, at + 1);
      if (at < 0) throw new Error(`"${snippet}" (#${nth}) isn't in ${this.path}`);
    }
    return `${at}:${Buffer.byteLength(snippet)}:0`;
  }

  ident(snippet: string, ref: number, nth = 0): AstNode {
    return { nodeType: "Identifier", id: this.id(), name: snippet, referencedDeclaration: ref, src: this.src(snippet, nth) };
  }

  str(value: string, nth = 0): AstNode {
    return { nodeType: "Literal", id: this.id(), kind: "string", value, src: this.src(`"${value}"`, nth) };
  }

  number(value: string, snippet: string, nth = 0): AstNode {
    return { nodeType: "Literal", id: this.id(), kind: "number", value, src: this.src(snippet, nth) };
  }

  /** `address(this)`-style conversion: only its text matters. */
  conversion(snippet: string, nth = 0): AstNode {
    return { nodeType: "FunctionCall", id: this.id(), kind: "typeConversion", arguments: [], src: this.src(snippet, nth) };
  }

  member(snippet: string, base: AstNode, memberName: string, typeString = "function ()", nth = 0): AstNode {
    return {
      nodeType: "MemberAccess",
      id: this.id(),
      memberName,
      expression: base,
      typeDescriptions: { typeString },
      src: this.src(snippet, nth),
    };
  }

  call(snippet: string, expression: AstNode, args: AstNode[], nth = 0): AstNode {
    return { nodeType: "FunctionCall", id: this.id(), kind: "functionCall", expression, arguments: args, names: [], src: this.src(snippet, nth) };
  }

  param(name: string, typeString: string, nth = 0): AstNode {
    return { nodeType: "VariableDeclaration", id: this.id(), name, typeDescriptions: { typeString }, src: this.src(name, nth) };
  }

  fn(opts: {
    name: string;
    snippet: string;
    params?: AstNode[];
    statements?: AstNode[];
    kind?: string;
    visibility?: string;
    selector?: string;
    mutability?: string;
    doc?: string;
  }): AstNode {
    const n: AstNode = {
      nodeType: "FunctionDefinition",
      id: this.id(),
      name: opts.name,
      kind: opts.kind ?? "function",
      visibility: opts.visibility ?? "internal",
      stateMutability: opts.mutability ?? "nonpayable",
      implemented: true,
      parameters: { nodeType: "ParameterList", parameters: opts.params ?? [] },
      body: { nodeType: "Block", statements: opts.statements ?? [] },
      src: this.src(opts.snippet),
    };
    if (opts.selector !== undefined) n.functionSelector = opts.selector;
    if (opts.doc !== undefined) n.documentation = { nodeType: "StructuredDocumentation", text: opts.doc };
    return n;
  }

  stmt(expression: AstNode): AstNode {
    return { nodeType: "ExpressionStatement", id: this.id(), expression };
  }

  local(decl: AstNode, initialValue: AstNode): AstNode {
    return { nodeType: "VariableDeclarationStatement", id: this.id(), declarations: [decl], initialValue };
  }

  assign(lhs: AstNode, rhs: AstNode): AstNode {
    return this.stmt({ nodeType: "Assignment", id: this.id(), operator: "=", leftHandSide: lhs, rightHandSide: rhs });
  }

  index(base: AstNode, index: AstNode): AstNode {
    return { nodeType: "IndexAccess", id: this.id(), baseExpression: base, indexExpression: index };
  }

  contract(name: string, nodes: AstNode[], contractKind = "contract"): AstNode {
    return { nodeType: "ContractDefinition", id: this.id(), name, contractKind, abstract: false, nodes };
  }

  import(absolutePath: string, names: string[]): AstNode {
    return {
      nodeType: "ImportDirective",
      id: this.id(),
      absolutePath,
      unitAlias: "",
      symbolAliases: names.map((name) => ({ foreign: { nodeType: "Identifier", name } })),
    };
  }

  unit(nodes: AstNode[]): Unit {
    return makeUnit(this.path, { nodeType: "SourceUnit", id: this.id(), absolutePath: this.path, nodes }, this.bytes);
  }
}

export function loaderOf(units: Unit[]): UnitLoader {
  const byPath = new Map(units.map((u) => [u.path, u]));
  return async (path) => byPath.get(path);
}

/** A minimal artifact: what `initFactsFor` reads (ABI, methodIdentifiers, devdoc). */
export function artifactOf(
  contract: string,
  sourcePath: string,
  abi: unknown[],
  methodIdentifiers: Record<string, `0x${string}`>,
  devParams: Record<string, Record<string, string>> = {},
): Artifact {
  const methods: Record<string, { params: Record<string, string> }> = {};
  for (const [sig, params] of Object.entries(devParams)) methods[sig] = { params };
  return {
    contract,
    path: `out/${contract}.json`,
    sourcePath,
    abi: abi as Artifact["abi"],
    methodIdentifiers,
    bytecode: { object: "0x", linkReferences: {} },
    deployedBytecode: { object: "0x", linkReferences: {}, immutableReferences: {} },
    metadata: {
      compiler: { version: "0.8.36" },
      language: "Solidity",
      settings: { compilationTarget: { [sourcePath]: contract } },
      sources: {},
      output: { abi, userdoc: {}, devdoc: { methods } },
    },
  };
}
