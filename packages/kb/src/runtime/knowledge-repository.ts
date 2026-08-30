/**
 * KnowledgeRepository — loads dist/knowledge_base.json into memory.
 * Provides typed getters by id, type, kpi, problem_type.
 *
 * NO writes at runtime. NO tenant data. Global, versioned.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  KnowledgeBase,
  KbItem,
  Concept,
  KpiItem,
  DiagnosticRule,
  Playbook,
  Relation,
  ProblemType,
} from '../types.js';

// Resolve dist path relative to this file (works for both tsc output and tsx direct).
// O JSON compilado vive sempre em <pkgRoot>/dist/knowledge_base.json. Tanto o layout
// compilado (<pkgRoot>/dist/runtime/knowledge-repository.js) quanto o de fonte
// (<pkgRoot>/src/runtime/knowledge-repository.ts) tem o pkgRoot 3 niveis acima deste
// arquivo. Tentamos candidatos e usamos o primeiro que existir (robusto a layout).
function resolveDistPath(): string {
  const here = fileURLToPath(import.meta.url);
  const primary = join(here, '..', '..', '..', 'dist', 'knowledge_base.json'); // {dist,src}/runtime -> <pkgRoot>/dist
  const candidates = [
    primary,
    join(here, '..', '..', 'knowledge_base.json'), // fallback: dist/runtime -> dist
    join(here, '..', '..', '..', '..', 'dist', 'knowledge_base.json'), // layout legado
  ];
  return candidates.find((c) => existsSync(c)) ?? primary;
}

export class KnowledgeRepository {
  private readonly _kb: KnowledgeBase;
  private readonly _byId: ReadonlyMap<string, KbItem>;

  constructor(kbPath?: string) {
    const path = kbPath ?? resolveDistPath();
    const raw = readFileSync(path, 'utf-8');
    this._kb = JSON.parse(raw) as KnowledgeBase;
    const map = new Map<string, KbItem>();
    for (const item of this._kb.items) {
      map.set(item.id, item);
    }
    this._byId = map;
  }

  /** Semver of the loaded knowledge base. */
  get version(): string {
    return this._kb.manifest.kb_version;
  }

  get manifest(): KnowledgeBase['manifest'] {
    return this._kb.manifest;
  }

  getById(id: string): KbItem | undefined {
    return this._byId.get(id);
  }

  hasId(id: string): boolean {
    return this._byId.has(id);
  }

  getConcepts(): ReadonlyArray<Concept> {
    return this._kb.items.filter((i): i is Concept => i.type === 'concept');
  }

  getKpis(): ReadonlyArray<KpiItem> {
    return this._kb.items.filter((i): i is KpiItem => i.type === 'kpi');
  }

  getRules(): ReadonlyArray<DiagnosticRule> {
    return this._kb.items.filter((i): i is DiagnosticRule => i.type === 'diagnostic_rule');
  }

  getPlaybooks(): ReadonlyArray<Playbook> {
    return this._kb.items.filter((i): i is Playbook => i.type === 'playbook');
  }

  getRelations(): ReadonlyArray<Relation> {
    return this._kb.items.filter((i): i is Relation => i.type === 'relation');
  }

  getKpiById(kpiId: string): KpiItem | undefined {
    const item = this._byId.get(kpiId);
    return item?.type === 'kpi' ? (item as KpiItem) : undefined;
  }

  getRuleById(ruleId: string): DiagnosticRule | undefined {
    const item = this._byId.get(ruleId);
    return item?.type === 'diagnostic_rule' ? (item as DiagnosticRule) : undefined;
  }

  getPlaybookById(playbookId: string): Playbook | undefined {
    const item = this._byId.get(playbookId);
    return item?.type === 'playbook' ? (item as Playbook) : undefined;
  }

  getKpiContext(kpiIds: readonly string[]): ReadonlyArray<KpiItem> {
    const result: KpiItem[] = [];
    for (const id of kpiIds) {
      const kpi = this.getKpiById(id);
      if (kpi !== undefined) result.push(kpi);
    }
    return result;
  }

  /** Returns all approved rules. */
  getActiveRules(): ReadonlyArray<DiagnosticRule> {
    return this.getRules().filter((r) => r.status === 'approved');
  }

  /** Returns playbooks whose problem_type intersects with any of the given types. */
  findPlaybooksForProblemTypes(problemTypes: readonly ProblemType[]): ReadonlyArray<Playbook> {
    const set = new Set(problemTypes);
    return this.getPlaybooks().filter(
      (pb) => pb.status === 'approved' && pb.problem_type.some((pt) => set.has(pt)),
    );
  }

  /** Returns concepts whose related_kpis intersect with the given kpi ids. */
  findConceptsForKpis(kpiIds: readonly string[]): ReadonlyArray<Concept> {
    const set = new Set(kpiIds);
    return this.getConcepts().filter(
      (c) => c.status === 'approved' && (c.related_kpis ?? []).some((k) => set.has(k)),
    );
  }
}
