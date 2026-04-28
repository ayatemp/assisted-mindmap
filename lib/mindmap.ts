export type NodeKind = 'theme' | 'idea' | 'question' | 'evidence' | 'risk';

export type MindNode = {
  id: string;
  text: string;
  note: string;
  kind: NodeKind;
  children: string[];
  createdAt: string;
  updatedAt: string;
  hintCursor: number;
};

export type MindProject = {
  id: string;
  title: string;
  summary: string;
  rootId: string;
  nodes: Record<string, MindNode>;
  createdAt: string;
  updatedAt: string;
};

export type PositionedNode = MindNode & {
  x: number;
  y: number;
  depth: number;
};

export type MindmapLayout = {
  nodes: PositionedNode[];
  edges: { from: PositionedNode; to: PositionedNode }[];
  width: number;
  height: number;
};

const now = () => new Date().toISOString();

export function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createNode(text: string, kind: NodeKind = 'idea'): MindNode {
  const timestamp = now();

  return {
    id: createId('node'),
    text: text.trim() || '新しいノード',
    note: '',
    kind,
    children: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    hintCursor: 0,
  };
}

export function createProject(title: string, summary = ''): MindProject {
  const root = createNode(title, 'theme');
  const timestamp = now();

  return {
    id: createId('project'),
    title: title.trim() || 'Untitled project',
    summary: summary.trim(),
    rootId: root.id,
    nodes: { [root.id]: root },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createSeedProjects(): MindProject[] {
  const pseudo = createProject(
    'pseudoGTの新しい研究案',
    'pseudo ground truthとYOLOを起点に、研究仮説・既存手法・実験設計を広げる。'
  );
  const pseudoRoot = pseudo.nodes[pseudo.rootId];
  const existing = createNode('既存手法の整理', 'question');
  existing.note = '教師あり、半教師あり、self-training、teacher-studentの系統で分けて見る。';
  const uncertainty = createNode('疑似ラベルの信頼度推定', 'idea');
  const experiments = createNode('検証プロトコル', 'evidence');
  pseudoRoot.children = [existing.id, uncertainty.id, experiments.id];
  pseudo.nodes = {
    ...pseudo.nodes,
    [pseudoRoot.id]: pseudoRoot,
    [existing.id]: existing,
    [uncertainty.id]: uncertainty,
    [experiments.id]: experiments,
  };

  const business = createProject(
    'LLMの企業案',
    'LLMを使った事業アイデアを、顧客課題・差別化・検証方法に分解する。'
  );
  const businessRoot = business.nodes[business.rootId];
  const customer = createNode('誰の痛みを解くか', 'question');
  const wedge = createNode('最初の導入先', 'idea');
  businessRoot.children = [customer.id, wedge.id];
  business.nodes = {
    ...business.nodes,
    [businessRoot.id]: businessRoot,
    [customer.id]: customer,
    [wedge.id]: wedge,
  };

  return [pseudo, business];
}

export function getPath(project: MindProject, nodeId: string) {
  const result: MindNode[] = [];

  function visit(id: string, stack: MindNode[]): boolean {
    const node = project.nodes[id];
    if (!node) return false;
    const nextStack = [...stack, node];
    if (id === nodeId) {
      result.push(...nextStack);
      return true;
    }
    return node.children.some((childId) => visit(childId, nextStack));
  }

  visit(project.rootId, []);
  return result;
}

export function findParentId(project: MindProject, childId: string) {
  return Object.values(project.nodes).find((node) => node.children.includes(childId))?.id ?? null;
}

export function getDescendantIds(project: MindProject, nodeId: string) {
  const ids: string[] = [];

  function visit(id: string) {
    ids.push(id);
    project.nodes[id]?.children.forEach(visit);
  }

  visit(nodeId);
  return ids;
}

export function layoutMindmap(project: MindProject): MindmapLayout {
  const positioned = new Map<string, PositionedNode>();
  const depthGap = 286;
  const rowGap = 124;
  const startX = 32;
  const startY = 42;
  let row = 0;

  function place(id: string, depth: number): number {
    const node = project.nodes[id];
    if (!node) return row * rowGap;

    if (node.children.length === 0) {
      const y = startY + row * rowGap;
      row += 1;
      positioned.set(id, { ...node, x: startX + depth * depthGap, y, depth });
      return y;
    }

    const childYs = node.children.map((childId) => place(childId, depth + 1));
    const y = childYs.reduce((sum, value) => sum + value, 0) / childYs.length;
    positioned.set(id, { ...node, x: startX + depth * depthGap, y, depth });
    return y;
  }

  place(project.rootId, 0);

  const nodes = Array.from(positioned.values()).sort((a, b) => a.depth - b.depth || a.y - b.y);
  const edges = nodes.flatMap((node) =>
    node.children
      .map((childId) => positioned.get(childId))
      .filter((child): child is PositionedNode => Boolean(child))
      .map((child) => ({ from: node, to: child }))
  );

  const width = Math.max(920, ...nodes.map((node) => node.x + 260));
  const height = Math.max(620, ...nodes.map((node) => node.y + 110));

  return { nodes, edges, width, height };
}

const pseudoHints = [
  '既存のpseudo-label / teacher-student系では、どの前提が今回の研究案とズレていますか？',
  'YOLO側の失敗例を、ラベル品質・ドメイン差・閾値設計のどこで説明できますか？',
  '「疑似GTの質が上がった」と言うために、mAP以外で測るべき指標はありますか？',
  '手法の新規性は、生成方法・選別方法・学習スケジュールのどこに置けそうですか？',
  '既存データセットで再現できる小さな実験と、独自価値が出る実験を分けるとどうなりますか？',
];

const businessHints = [
  '最初にお金を払う人は誰で、その人は今どんな代替手段で我慢していますか？',
  'LLMである必然性は、検索・自動化・意思決定支援のどこにありますか？',
  '大企業向けと個人向けで、導入障壁が一番違う点は何ですか？',
  '最小のPoCで「これは欲しい」と言わせる体験は、どの1ワークフローですか？',
  '競合に真似されにくい資産は、データ・業務知識・配布チャネルのどこに作れますか？',
];

const generalHints = [
  'この枝の前提になっている仮説を1つだけ書くなら何ですか？',
  '反対意見を置くとしたら、どの枝として追加すると全体が強くなりますか？',
  '既存例、失敗例、評価方法のうち、今いちばん薄い観点はどれですか？',
  '次に調べるべきキーワードを3つに絞るなら何ですか？',
  'このアイデアを検証可能な問いに変換すると、どんな実験になりますか？',
];

export function createAssistantHint(project: MindProject, nodeId: string) {
  const node = project.nodes[nodeId];
  const path = getPath(project, nodeId);
  const context = `${project.title} ${project.summary} ${path.map((item) => item.text).join(' ')}`.toLowerCase();
  const bank = context.includes('pseudogt') || context.includes('pseudo') || context.includes('yolo')
    ? pseudoHints
    : context.includes('llm') || context.includes('企業') || context.includes('事業')
      ? businessHints
      : generalHints;
  const cursor = node?.hintCursor ?? 0;
  const base = bank[cursor % bank.length];
  const focus = node ? `いま選んでいる「${node.text}」について、` : '';

  return `${focus}${base}`;
}

export function bumpProject(project: MindProject): MindProject {
  return { ...project, updatedAt: now() };
}

export function touchNode(node: MindNode): MindNode {
  return { ...node, updatedAt: now() };
}
