/**
 * Core type system for the filter DSL.
 * Covers -vf, -af, and -filter_complex graph building.
 */

/**
 * A single filter in a chain, e.g. scale=1280:720 or volume=1.5
 */
export interface FilterNode {
  /** Filter name, e.g. "scale", "overlay" */
  name: string;
  /** Positional args in order */
  positional: (string | number)[];
  /** Named key=value args */
  named: Record<string, string | number | boolean>;
}

type FilterNodeOrRaw = { kind: 'node'; node: FilterNode } | { kind: 'raw'; raw: string };

/**
 * Serialize a FilterNode to its ffmpeg string representation.
 * e.g. { name:'scale', positional:[1280,720], named:{flags:'lanczos'} }
 *   → "scale=1280:720:flags=lanczos"
 */
export function serializeNode(node: FilterNode): string {
  const parts: string[] = [];

  // Positional args join with ':'
  if (node.positional.length > 0) {
    parts.push(node.positional.map(String).join(':'));
  }

  // Named args join as key=value pairs, then ':' between them
  const named = Object.entries(node.named);
  if (named.length > 0) {
    const toFfmpegValue = (v: string | number | boolean): string => {
      if (typeof v === 'boolean') return v ? '1' : '0';
      return String(v);
    };
    parts.push(...named.map(([k, v]) => `${k}=${toFfmpegValue(v)}`));
  }

  if (parts.length === 0) return node.name;
  return `${node.name}=${parts.join(':')}`;
}

/**
 * A complete filter chain (for -vf or -af).
 * Filters are applied in order, output of each feeds the next.
 */
export class FilterChain {
  private readonly nodes: FilterNodeOrRaw[] = [];

  /** Add a raw FilterNode */
  add(node: FilterNode): this {
    this.nodes.push({ kind: 'node', node });
    return this;
  }

  /** Add a raw filter string (escape hatch) */
  raw(filterStr: string): this {
    this.nodes.push({ kind: 'raw', raw: filterStr });
    return this;
  }

  /** Serialize the full chain to a comma-separated string */
  toString(): string {
    return this.nodes
      .map((n) => (n.kind === 'raw' ? n.raw : serializeNode(n.node)))
      .join(',');
  }

  /** Number of filters in the chain */
  get length(): number {
    return this.nodes.length;
  }

  /** Get all nodes (for testing/inspection) */
  getNodes(): readonly FilterNodeOrRaw[] {
    return this.nodes;
  }
}

/**
 * A labeled pad in a filter_complex graph.
 * e.g. "[v0]", "[audio_out]"
 */
export interface GraphPad {
  /** The pad label without brackets, e.g. "v0" */
  label: string;
  /** String representation with brackets for use in filter_complex */
  toString(): string;
}

/**
 * Create a GraphPad from a label string.
 */
export function pad(label: string): GraphPad {
  return {
    label,
    toString: () => `[${label}]`,
  };
}

/**
 * A single link in a filter_complex graph.
 * inputs → filter → outputs
 */
export interface GraphLink {
  inputs: GraphPad[];
  filter: FilterNode;
  outputs: GraphPad[];
}

/**
 * Serialize a GraphLink to its filter_complex segment string.
 * e.g. [0:v][1:v]overlay=x=10:y=10[out]
 */
export function serializeLink(link: GraphLink): string {
  const ins = link.inputs.map(String).join('');
  const filter = serializeNode(link.filter);
  const outs = link.outputs.map(String).join('');
  return `${ins}${filter}${outs}`;
}
