export class UnionFind {
  private readonly parent = new Map<string, string>();
  private readonly rank = new Map<string, number>();

  constructor(ids: Iterable<string>) {
    for (const id of ids) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (parent === undefined) {
      throw new Error(`UnionFind: unknown id "${id}"`);
    }
    if (parent === id) {
      return id;
    }
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) {
      return;
    }

    const rankA = this.rank.get(rootA) ?? 0;
    const rankB = this.rank.get(rootB) ?? 0;
    if (rankA < rankB) {
      this.parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA);
    } else {
      this.parent.set(rootB, rootA);
      this.rank.set(rootA, rankA + 1);
    }
  }

  connected(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }

  componentCount(): number {
    const roots = new Set<string>();
    for (const id of this.parent.keys()) {
      roots.add(this.find(id));
    }
    return roots.size;
  }
}

// The hard assert (docs/architecture/engine.md §map/): generation must fail
// loud, not silently ship a disconnected map. The network builder is
// constructed to always produce a spanning tree, so this should never
// actually throw -- it exists to catch a bug in that construction, not to
// paper over one.
export function assertFullyConnected(nodeIds: string[], edges: Array<[string, string]>): void {
  const unionFind = new UnionFind(nodeIds);
  for (const [a, b] of edges) {
    unionFind.union(a, b);
  }

  const componentCount = unionFind.componentCount();
  if (nodeIds.length > 0 && componentCount !== 1) {
    throw new Error(
      `Map generation produced a disconnected network: ${componentCount} components across ${nodeIds.length} nodes.`,
    );
  }
}
