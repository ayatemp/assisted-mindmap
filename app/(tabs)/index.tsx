import { Feather } from '@expo/vector-icons';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Svg, { Path } from 'react-native-svg';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native';

import {
  MindNode,
  NodeAuthor,
  NodeDisplay,
  MindProject,
  NodeKind,
  NodeTag,
  bumpProject,
  createAssistantSeed,
  createId,
  createNode,
  createProject,
  createSeedProjects,
  defaultNodeTags,
  findParentId,
  getDescendantIds,
  getNodeSize,
  getPath,
  layoutMindmap,
  nodeSizes,
  sanitizeProject,
  touchNode,
} from '@/lib/mindmap';

const STORAGE_KEY = 'assisted-mindmap-projects-v1';
const OPENAI_KEY_STORAGE_KEY = 'assisted-mindmap-openai-key-v1';
const CODEX_CHAT_STORAGE_KEY = 'assisted-mindmap-codex-chats-v1';
const AI_BATCH_MODEL = 'gpt-5.4';
const maxCodexConversationsPerProject = 5;
const nodeWidth = nodeSizes.node.width;
const nodeHeight = nodeSizes.node.height;
const childOffsetX = 286;
const childOffsetY = 112;
const minZoom = 0.45;
const maxZoom = 2.2;
const fitPadding = 120;
const canvasPaddingX = 960;
const canvasPaddingY = 760;
const webCanvasViewportStyle =
  Platform.OS === 'web'
    ? ({
        overflow: 'scroll',
        overscrollBehavior: 'contain',
        scrollbarWidth: 'thin',
        touchAction: 'none',
      } as object)
    : {};
const webResizeHandleStyle =
  Platform.OS === 'web'
    ? ({
        cursor: 'col-resize',
      } as object)
    : {};
const webNodeNoSelectStyle =
  Platform.OS === 'web'
    ? ({
        userSelect: 'none',
        WebkitUserSelect: 'none',
      } as object)
    : {};
const webMoveCursorStyle =
  Platform.OS === 'web'
    ? ({
        cursor: 'move',
      } as object)
    : {};
const webNoFocusRingStyle =
  Platform.OS === 'web'
    ? ({
        outlineStyle: 'none',
        outlineWidth: 0,
        boxShadow: 'none',
      } as object)
    : {};
const webGrabCursorStyle =
  Platform.OS === 'web'
    ? ({
        cursor: 'grab',
      } as object)
    : {};
const webGrabbingCursorStyle =
  Platform.OS === 'web'
    ? ({
        cursor: 'grabbing',
      } as object)
    : {};
const PANEL_STORAGE_KEY = 'assisted-mindmap-panels-v1';
const sidebarMinWidth = 232;
const sidebarMaxWidth = 420;
const inspectorMinWidth = 300;
const inspectorMaxWidth = 980;
const tagColorOptions = ['#0F766E', '#2563EB', '#7C3AED', '#DC2626', '#D97706', '#0891B2', '#475569'];
const memoLineBottomOffset = 1.25;
const memoLineWidth = 2.5;
const canvasDragPanSensitivity = 1.85;
const trackpadZoomSensitivity = 0.00135;

function loadPanelSizes() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return { sidebar: 292, inspector: 360 };
  }

  try {
    const raw = window.localStorage.getItem(PANEL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      sidebar: typeof parsed?.sidebar === 'number' ? parsed.sidebar : 292,
      inspector: typeof parsed?.inspector === 'number' ? parsed.inspector : 360,
    };
  } catch {
    return { sidebar: 292, inspector: 360 };
  }
}

function clampZoom(value: number) {
  return Math.min(maxZoom, Math.max(minZoom, value));
}

function loadProjects() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return createSeedProjects();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MindProject[]).map(sanitizeProject) : createSeedProjects();
  } catch {
    return createSeedProjects();
  }
}

function saveProjects(projects: MindProject[]) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

function loadOpenAiKey() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
  return window.localStorage.getItem(OPENAI_KEY_STORAGE_KEY) ?? '';
}

function saveOpenAiKey(key: string) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  if (key.trim()) {
    window.localStorage.setItem(OPENAI_KEY_STORAGE_KEY, key.trim());
    return;
  }
  window.localStorage.removeItem(OPENAI_KEY_STORAGE_KEY);
}

function loadCodexConversations() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(CODEX_CHAT_STORAGE_KEY);
    return raw ? sanitizeCodexConversations(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function saveCodexConversations(conversations: CodexConversation[]) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.localStorage.setItem(CODEX_CHAT_STORAGE_KEY, JSON.stringify(conversations));
}

function findTag(tags: NodeTag[] | undefined, kind: NodeKind) {
  return tags?.find((tag) => tag.id === kind) ?? defaultNodeTags.find((tag) => tag.id === kind);
}

function kindLabel(tags: NodeTag[] | undefined, kind: NodeKind) {
  return findTag(tags, kind)?.label ?? kind;
}

function kindColor(tags: NodeTag[] | undefined, kind: NodeKind) {
  return findTag(tags, kind)?.color ?? '#64748B';
}

function authorLabel(author: NodeAuthor) {
  return author === 'ai' ? 'AI' : 'YOU';
}

function authorPalette(author: NodeAuthor) {
  return author === 'ai'
    ? {
        background: '#EFF6FF',
        border: '#93C5FD',
        badgeBackground: '#DBEAFE',
        badgeText: '#1D4ED8',
      }
    : {
        background: '#FFFFFF',
        border: '#D6DDE8',
        badgeBackground: '#ECFDF3',
        badgeText: '#047857',
      };
}

type GeneratedMemo = {
  title: string;
  body: string;
};

type CodexSuggestion = {
  id: string;
  title: string;
  text: string;
  note: string;
  kind: NodeKind;
  display: NodeDisplay;
  parentId: string;
};

type CodexChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  suggestions?: CodexSuggestion[];
};

type CodexConversation = {
  id: string;
  projectId: string;
  title: string;
  messages: CodexChatMessage[];
  createdAt: string;
  updatedAt: string;
};

function compactText(value: string, maxLength = 260) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function sanitizeCodexConversations(raw: unknown): CodexConversation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): CodexConversation | null => {
      const conversation = item as Partial<CodexConversation>;
      const projectId = String(conversation.projectId ?? '').trim();
      if (!projectId) return null;
      const messages: CodexChatMessage[] = Array.isArray(conversation.messages)
        ? conversation.messages
            .map((message): CodexChatMessage => {
              const record = message as Partial<CodexChatMessage>;
              const role: CodexChatMessage['role'] = record.role === 'assistant' ? 'assistant' : 'user';
              const suggestions: CodexSuggestion[] | undefined = Array.isArray(record.suggestions)
                ? record.suggestions.map((suggestion) => ({
                    id: String(suggestion.id || createId('suggestion')),
                    title: String(suggestion.title || '候補'),
                    text: String(suggestion.text || suggestion.title || '新しい枝'),
                    note: String(suggestion.note || ''),
                    kind: String(suggestion.kind || 'idea'),
                    display: suggestion.display === 'memo' ? 'memo' : 'node',
                    parentId: String(suggestion.parentId || ''),
                  }))
                : undefined;
              return {
                id: String(record.id || createId('msg')),
                role,
                text: String(record.text || ''),
                createdAt: String(record.createdAt || new Date().toISOString()),
                suggestions,
              };
            })
            .filter((message) => message.text.trim())
        : [];
      return {
        id: String(conversation.id || createId('chat')),
        projectId,
        title: String(conversation.title || '新しい相談'),
        messages,
        createdAt: String(conversation.createdAt || new Date().toISOString()),
        updatedAt: String(conversation.updatedAt || new Date().toISOString()),
      };
    })
    .filter((item): item is CodexConversation => Boolean(item));
}

function buildMindmapPrompt(project: MindProject, nodeId: string) {
  const node = project.nodes[nodeId];
  const path = getPath(project, nodeId)
    .map((item) => item.text)
    .join(' > ');
  const tags = project.tags.map((tag) => `${tag.label}(${tag.id})`).join(', ');
  const nodes = Object.values(project.nodes)
    .map((item) => {
      const tag = kindLabel(project.tags, item.kind);
      const note = item.note ? ` / note: ${compactText(item.note, 160)}` : '';
      return `- [${tag}/${item.author}/${item.display}] ${compactText(item.text)}${note}`;
    })
    .join('\n');

  return [
    `Project: ${project.title}`,
    project.summary ? `Summary: ${project.summary}` : '',
    `Selected path: ${path}`,
    `Selected node: ${node?.text ?? ''}`,
    node?.note ? `Selected note: ${node.note}` : '',
    `Available labels: ${tags}`,
    '',
    'Current tree:',
    nodes,
    '',
    'Task:',
    '選択ノードから次に伸ばすべき具体的な内容を、4〜5個の詳細メモとして日本語で作る。',
    '必要ならweb searchで近年の既存手法・論点・評価軸を調べ、抽象的な問いではなく、そのままマインドマップに貼れる調査メモにする。',
    '文体は常体・メモ調。「です」「ます」は使わない。',
    '各メモは title と body を持ち、body は2〜4文で、研究・事業・実験の次の作業に使える密度にする。',
  ]
    .filter(Boolean)
    .join('\n');
}

function extractResponseText(payload: any) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const parts: string[] = [];
  payload?.output?.forEach((item: any) => {
    item?.content?.forEach((content: any) => {
      if (typeof content?.text === 'string') parts.push(content.text);
      if (typeof content?.output_text === 'string') parts.push(content.output_text);
    });
  });
  return parts.join('\n');
}

function normalizeGeneratedMemos(value: unknown): GeneratedMemo[] {
  const source = Array.isArray(value) ? value : (value as { memos?: unknown })?.memos;
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => {
      const record = item as { title?: unknown; body?: unknown };
      return {
        title: String(record.title ?? '').trim(),
        body: String(record.body ?? '').trim(),
      };
    })
    .filter((item) => item.title && item.body)
    .slice(0, 5);
}

function parseGeneratedMemos(text: string) {
  try {
    return normalizeGeneratedMemos(JSON.parse(text));
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
      return normalizeGeneratedMemos(JSON.parse(match[0]));
    } catch {
      return [];
    }
  }
}

async function generateResearchMemosWithOpenAI(project: MindProject, nodeId: string, apiKey: string) {
  if (!apiKey.trim()) throw new Error('OpenAI API key is empty');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: AI_BATCH_MODEL,
      tools: [{ type: 'web_search_preview', search_context_size: 'medium' }],
      tool_choice: 'auto',
      input: [
        {
          role: 'developer',
          content: [
            {
              type: 'input_text',
              text:
                'You are a research partner for an assisted mindmap app. Return only valid JSON that matches the schema. Write in Japanese plain-form memo style. Do not use polite endings such as です or ます. Use web search when it helps make the memo concrete and current.',
            },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: buildMindmapPrompt(project, nodeId) }],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'mindmap_memo_batch',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['memos'],
            properties: {
              memos: {
                type: 'array',
                minItems: 4,
                maxItems: 5,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['title', 'body'],
                  properties: {
                    title: { type: 'string' },
                    body: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      max_output_tokens: 3200,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? 'OpenAI request failed');
  }

  const memos = parseGeneratedMemos(extractResponseText(data));
  if (memos.length < 4) throw new Error('OpenAI returned too few memos');
  return memos;
}

function createFallbackResearchMemos(project: MindProject, nodeId: string): GeneratedMemo[] {
  const context = [
    project.title,
    project.summary,
    ...getPath(project, nodeId).map((node) => node.text),
    ...Object.values(project.nodes).flatMap((node) => [node.text, node.note]),
  ]
    .join(' ')
    .toLowerCase();

  if (context.includes('pseudogt') || context.includes('pseudo') || context.includes('yolo')) {
    return [
      {
        title: '既存手法を系統ごとに棚卸しする',
        body:
          'pseudoGT周りは、self-training、teacher-student、confidence thresholding、consistency regularization、active learningの5系統に分けて整理すると枝が伸ばしやすい。YOLOを使うなら、検出器が出すbox/class/confidenceをそのまま疑似GTにするのか、別モデルやTTAで補正するのかを分けて書くと研究案の輪郭が出る。',
      },
      {
        title: '疑似ラベルの失敗パターンを先に定義する',
        body:
          '小物体、遮蔽、背景との混同、ドメインシフト、class imbalance、NMSによるbox欠落は、pseudoGTの品質を落としやすい軸。各失敗に対して「検出できない」「boxがずれる」「クラスが違う」「余計なboxが増える」のどれかに分類すると、後の評価指標と改善手法に接続できる。',
      },
      {
        title: '信頼度を単一閾値ではなく校正する',
        body:
          'YOLOのconfidenceを固定閾値で切るだけだと、クラスごとの難易度やデータ分布の違いを吸収しにくい。class-wise threshold、temperature scaling、ensemble agreement、TTA consistencyを使って「採用してよい疑似GT」を校正する案を書くと、手法としての独自性を作りやすい。',
      },
      {
        title: '評価はmAPだけでなく疑似GT品質も見る',
        body:
          '最終モデルのmAPだけでなく、少量の人手アノテーションを検証セットとして、pseudo label precision/recall、box IoU、クラス別の誤ラベル率も見る。これにより「性能が上がった」だけでなく「どの種類の疑似GTが学習を助けたか」まで説明できる。',
      },
      {
        title: '実験は段階的なアブレーションにする',
        body:
          'baseline YOLO、固定閾値pseudoGT、class-wise threshold、TTA/ensemble、box refinementの順に足して比較すると、どの部品が効いたかが見える。さらに疑似ラベル量を25/50/75/100%で振ると、ラベルノイズとデータ量のトレードオフも論文っぽい論点になる。',
      },
    ];
  }

  if (context.includes('llm') || context.includes('企業') || context.includes('事業')) {
    return [
      {
        title: '最初に刺す顧客セグメントを1つに絞る',
        body:
          'LLM事業案は広げすぎると検証不能になるため、まず「誰が、どの作業で、何分損しているか」を1セグメントに絞る。業務ログ、既存SaaSのレビュー、社内ヒアリングから反復作業と判断ミスの場所を探すと、AI導入の入口が見える。',
      },
      {
        title: '代替手段との差分を明文化する',
        body:
          'ChatGPT単体、既存SaaS、BPO、社内マクロに対して、なぜこのプロダクトが必要なのかを書く必要がある。差分は精度だけでなく、既存データ接続、承認フロー、監査ログ、部署ごとのテンプレート化のような運用面で作ると強い。',
      },
      {
        title: 'PoCで測る数字を先に決める',
        body:
          'PoCでは「便利だった」ではなく、作業時間削減率、一次回答の採用率、修正回数、ヒューマンレビュー時間、エラー率を測ると次の意思決定につながる。導入前後で同じタスクを比較できるように、5〜10件の代表ケースを固定しておくとよい。',
      },
      {
        title: 'データ接続と権限が参入障壁になるかを見る',
        body:
          'LLM部分だけでは真似されやすいため、CRM、Slack、Notion、Drive、社内DBなどとの接続と権限管理を価値にできるか確認する。特に「誰が何を見てよいか」を安全に扱える設計は、企業向けでは機能そのものと同じくらい重要。',
      },
      {
        title: '最小プロダクトは1ワークフローに閉じる',
        body:
          '最初から万能アシスタントにせず、議事録から営業フォロー作成、問い合わせから回答ドラフト、論文PDFから検証計画作成など、入力と出力が明確な1ワークフローに閉じると売りやすい。ここで継続利用が出れば、隣接業務へ枝を伸ばせる。',
      },
    ];
  }

  return [
    {
      title: 'この枝の前提を分解する',
      body:
        'まず、このノードが成り立つための前提を「技術的に可能か」「ユーザーが欲しいか」「継続的に使われるか」「比較対象に勝てるか」に分けて書く。次に検証すべき枝が見える。',
    },
    {
      title: '既存手法・既存サービスを横に並べる',
      body:
        '似た手法やサービスを3〜5個集め、入力、出力、強み、弱み、未解決点を同じ粒度で比較する。差分が言語化できると、このアイデアが研究なのかプロダクトなのかも判断しやすくなる。',
    },
    {
      title: '評価指標を先に置く',
      body:
        '成功を判断する指標を先に決めると、枝がただの思いつきで終わりにくくなる。精度、時間、コスト、再現性、ユーザー満足、失敗率などから、このテーマに最も効く2〜3個を選ぶ。',
    },
    {
      title: '最小実験を1つ作る',
      body:
        'この枝を検証する最小実験として、1日で作れるプロトタイプ、少量データでの比較、5人へのヒアリング、既存ツールでの手動検証のどれが最短かを書く。小さな実験にすると次の行動に移しやすい。',
    },
    {
      title: 'リスクを先回りで書く',
      body:
        '失敗しそうな理由を先に書くと、良い枝だけでなく強い枝になる。データ不足、評価不能、差別化不足、運用コスト、ユーザーが習慣化しない問題を並べ、どれを潰せば前に進めるか決める。',
    },
  ];
}

function formatGeneratedMemo(memo: GeneratedMemo) {
  return `${memo.title.trim()}\n${memo.body.trim()}`;
}

function buildCodexChatPrompt(project: MindProject, nodeId: string, userText: string, messages: CodexChatMessage[]) {
  const node = project.nodes[nodeId];
  const path = getPath(project, nodeId)
    .map((item) => item.text)
    .join(' > ');
  const tree = Object.values(project.nodes)
    .map((item) => {
      const tag = kindLabel(project.tags, item.kind);
      const note = item.note ? ` / note: ${compactText(item.note, 120)}` : '';
      return `- [${tag}/${item.author}/${item.display}] ${compactText(item.text, 180)}${note}`;
    })
    .join('\n');
  const recent = messages
    .slice(-8)
    .map((message) => `${message.role}: ${message.text}`)
    .join('\n');

  return [
    `Project: ${project.title}`,
    project.summary ? `Summary: ${project.summary}` : '',
    `Selected path: ${path}`,
    `Selected node: ${node?.text ?? ''}`,
    node?.note ? `Selected note: ${node.note}` : '',
    '',
    'Current tree:',
    tree,
    '',
    'Recent conversation:',
    recent,
    '',
    `User says: ${userText}`,
    '',
    'Task:',
    'ユーザーの迷いを受けて、次にどのノードを広げるべきかを日本語で相談相手として返答する。',
    '返答は短めにし、具体的な追加候補を3個出す。',
    'suggestions は、そのままマインドマップに追加できるノードまたはメモにする。',
  ]
    .filter(Boolean)
    .join('\n');
}

function normalizeCodexReply(value: unknown, project: MindProject, parentId: string) {
  const record = value as { text?: unknown; suggestions?: unknown };
  const suggestions = Array.isArray(record.suggestions)
    ? record.suggestions
        .map((suggestion) => {
          const item = suggestion as Partial<CodexSuggestion>;
          const kind = project.tags.some((tag) => tag.id === item.kind) ? String(item.kind) : 'idea';
          return {
            id: createId('suggestion'),
            title: String(item.title || item.text || '追加候補').trim(),
            text: String(item.text || item.title || '新しい枝').trim(),
            note: String(item.note || '').trim(),
            kind,
            display: item.display === 'memo' ? 'memo' : 'node',
            parentId,
          } satisfies CodexSuggestion;
        })
        .filter((item) => item.title && item.text)
        .slice(0, 3)
    : [];

  return {
    text: String(record.text || '').trim(),
    suggestions,
  };
}

function parseCodexReply(text: string, project: MindProject, parentId: string) {
  try {
    return normalizeCodexReply(JSON.parse(text), project, parentId);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { text: text.trim(), suggestions: [] as CodexSuggestion[] };
    try {
      return normalizeCodexReply(JSON.parse(match[0]), project, parentId);
    } catch {
      return { text: text.trim(), suggestions: [] as CodexSuggestion[] };
    }
  }
}

async function generateCodexChatReply(
  project: MindProject,
  nodeId: string,
  userText: string,
  messages: CodexChatMessage[],
  apiKey: string
) {
  if (!apiKey.trim()) throw new Error('OpenAI API key is empty');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: AI_BATCH_MODEL,
      input: [
        {
          role: 'developer',
          content: [
            {
              type: 'input_text',
              text:
                'You are Codex inside a local mindmap app. Help the user think, then propose concrete next nodes. Return only valid JSON matching the schema. Write in Japanese.',
            },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: buildCodexChatPrompt(project, nodeId, userText, messages) }],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'codex_mindmap_chat',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['text', 'suggestions'],
            properties: {
              text: { type: 'string' },
              suggestions: {
                type: 'array',
                minItems: 1,
                maxItems: 3,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['title', 'text', 'note', 'kind', 'display'],
                  properties: {
                    title: { type: 'string' },
                    text: { type: 'string' },
                    note: { type: 'string' },
                    kind: { type: 'string' },
                    display: { type: 'string', enum: ['node', 'memo'] },
                  },
                },
              },
            },
          },
        },
      },
      max_output_tokens: 1800,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? 'OpenAI request failed');
  const reply = parseCodexReply(extractResponseText(data), project, nodeId);
  if (!reply.text) throw new Error('Empty Codex reply');
  return reply;
}

function createLocalCodexReply(project: MindProject, nodeId: string, userText: string) {
  const node = project.nodes[nodeId];
  const path = getPath(project, nodeId);
  const pathText = path.map((item) => item.text).join(' > ');
  const context = `${project.title} ${project.summary} ${pathText} ${userText}`.toLowerCase();
  const focus = node?.text ?? project.title;
  const wantsResearch = context.includes('pseudogt') || context.includes('pseudo') || context.includes('yolo') || context.includes('研究');
  const wantsBusiness = context.includes('llm') || context.includes('企業') || context.includes('事業') || context.includes('顧客');
  const kind = project.tags.some((tag) => tag.id === 'question') ? 'question' : 'idea';

  const suggestions: CodexSuggestion[] = wantsResearch
    ? [
        {
          id: createId('suggestion'),
          title: '既存手法との差分を切る',
          text: '既存手法との差分',
          note: 'self-training、teacher-student、confidence thresholdingと比較し、どこに新規性を置くかを分ける。',
          kind,
          display: 'node',
          parentId: nodeId,
        },
        {
          id: createId('suggestion'),
          title: '失敗パターンを集める',
          text: '失敗パターンの分類',
          note: '小物体、遮蔽、ドメインシフト、誤検出、boxずれを分けて、改善が効く場所を見つける。',
          kind: 'risk',
          display: 'node',
          parentId: nodeId,
        },
        {
          id: createId('suggestion'),
          title: '評価指標を決める',
          text: '評価指標メモ\nmAPだけでなく、pseudo label precision/recall、box IoU、クラス別誤ラベル率を見る。',
          note: '疑似GTそのものの品質と最終モデル性能を分けて評価する。',
          kind: 'memo',
          display: 'memo',
          parentId: nodeId,
        },
      ]
    : wantsBusiness
      ? [
          {
            id: createId('suggestion'),
            title: '最初の顧客を絞る',
            text: '最初の顧客セグメント',
            note: '誰が、どの作業で、どのくらい損しているかを1つに絞る。',
            kind,
            display: 'node',
            parentId: nodeId,
          },
          {
            id: createId('suggestion'),
            title: '代替手段との差分',
            text: '代替手段との差分',
            note: 'ChatGPT単体、既存SaaS、BPO、社内マクロと比べて勝てる理由を書く。',
            kind: 'idea',
            display: 'node',
            parentId: nodeId,
          },
          {
            id: createId('suggestion'),
            title: 'PoC指標',
            text: 'PoC指標メモ\n作業時間削減率、一次回答の採用率、修正回数、レビュー時間を測る。',
            note: '便利さではなく、意思決定できる数字に落とす。',
            kind: 'memo',
            display: 'memo',
            parentId: nodeId,
          },
        ]
      : [
          {
            id: createId('suggestion'),
            title: '前提仮説',
            text: '前提仮説',
            note: 'この枝が成り立つために暗黙に置いている前提を1つ書く。',
            kind,
            display: 'node',
            parentId: nodeId,
          },
          {
            id: createId('suggestion'),
            title: '次の検証',
            text: '次の検証方法',
            note: '観察、実験、比較、ヒアリングのどれで確かめるかを決める。',
            kind: 'evidence',
            display: 'node',
            parentId: nodeId,
          },
          {
            id: createId('suggestion'),
            title: '迷いのメモ',
            text: `迷いの整理\nいま迷っている中心は「${focus}」。薄い枝は、前提・反証条件・評価方法のどれか。`,
            note: '会話から見えた迷いをそのままメモにする。',
            kind: 'memo',
            display: 'memo',
            parentId: nodeId,
          },
        ];

  return {
    text: `今の迷いは「${focus}」の次を、調査・検証・リスクのどこに伸ばすかに見える。まずは1つだけ決めるなら、選択中ノードの直下に「比較対象」か「評価方法」を置くのがよさそう。下の候補から1つ追加して、そこを起点にさらに聞くとツリーが散らばりにくい。`,
    suggestions,
  };
}

export default function MindmapHome() {
  const initialPanels = loadPanelSizes();
  const [projects, setProjects] = useState<MindProject[]>(loadProjects);
  const [activeProjectId, setActiveProjectId] = useState('');
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [projectQuery, setProjectQuery] = useState('');
  const [newTagLabel, setNewTagLabel] = useState('');
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState('');
  const [openAiKey, setOpenAiKey] = useState(loadOpenAiKey);
  const [codexConversations, setCodexConversations] = useState<CodexConversation[]>(loadCodexConversations);
  const [activeCodexConversationId, setActiveCodexConversationId] = useState('');
  const [codexDraft, setCodexDraft] = useState('');
  const [codexStatus, setCodexStatus] = useState<'idle' | 'loading' | 'local' | 'error'>('idle');
  const [quickChildText, setQuickChildText] = useState('');
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [panningCanvas, setPanningCanvas] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [inspectorMode, setInspectorMode] = useState<'edit' | 'codex' | 'settings'>('edit');
  const [aiBatchStatus, setAiBatchStatus] = useState<'idle' | 'loading' | 'local' | 'fallback' | 'error'>('idle');
  const [zoom, setZoom] = useState(1);
  const [sidebarWidth, setSidebarWidth] = useState(initialPanels.sidebar);
  const [inspectorWidth, setInspectorWidth] = useState(initialPanels.inspector);
  const canvasScrollerRef = useRef<any>(null);
  const zoomRef = useRef(1);
  const applyZoomRef = useRef<(nextZoom: number, focus?: { x: number; y: number }) => void>(() => {});
  const pendingZoomScrollRef = useRef<{ left: number; top: number } | null>(null);
  const wheelZoomRef = useRef<{
    frame: number | null;
    multiplier: number;
    focus: { x: number; y: number };
  }>({
    frame: null,
    multiplier: 1,
    focus: { x: 0, y: 0 },
  });
  const gestureZoomRef = useRef<{
    startZoom: number;
    focus: { x: number; y: number };
  } | null>(null);
  const dragRef = useRef<{
    nodeId: string;
    startPageX: number;
    startPageY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const panRef = useRef<{
    startPageX: number;
    startPageY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);
  const resizeRef = useRef<{
    panel: 'sidebar' | 'inspector';
    startX: number;
    startWidth: number;
  } | null>(null);
  const { width } = useWindowDimensions();
  const compact = width < 920;

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    window.localStorage.setItem(
      PANEL_STORAGE_KEY,
      JSON.stringify({ sidebar: sidebarWidth, inspector: inspectorWidth })
    );
  }, [inspectorWidth, sidebarWidth]);

  useEffect(() => {
    saveOpenAiKey(openAiKey);
  }, [openAiKey]);

  useEffect(() => {
    saveCodexConversations(codexConversations);
  }, [codexConversations]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const pending = pendingZoomScrollRef.current;
    if (!pending) return;

    const node = canvasScrollerRef.current;
    if (!node) return;
    node.scrollLeft = pending.left;
    node.scrollTop = pending.top;
    pendingZoomScrollRef.current = null;
  }, [zoom]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    function handleMouseMove(event: MouseEvent) {
      const current = resizeRef.current;
      if (!current) return;

      if (current.panel === 'sidebar') {
        const nextWidth = Math.min(
          Math.max(current.startWidth + (event.clientX - current.startX), sidebarMinWidth),
          Math.min(sidebarMaxWidth, width * 0.42)
        );
        setSidebarWidth(Math.round(nextWidth));
        return;
      }

      const nextWidth = Math.min(
        Math.max(current.startWidth - (event.clientX - current.startX), inspectorMinWidth),
        Math.min(inspectorMaxWidth, width * 0.5)
      );
      setInspectorWidth(Math.round(nextWidth));
    }

    function handleMouseUp() {
      resizeRef.current = null;
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [width]);

  const selectedProject = activeProject;
  const selectedNode = selectedProject?.nodes[selectedNodeId] ?? selectedProject?.nodes[selectedProject.rootId];
  const layout = useMemo(
    () => (selectedProject ? layoutMindmap(selectedProject) : null),
    [selectedProject]
  );
  const selectedPath = selectedProject && selectedNode ? getPath(selectedProject, selectedNode.id) : [];
  const pendingDeleteProject = projects.find((project) => project.id === pendingDeleteProjectId);
  const projectCodexConversations = useMemo(
    () =>
      selectedProject
        ? codexConversations
            .filter((conversation) => conversation.projectId === selectedProject.id)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        : [],
    [codexConversations, selectedProject]
  );
  const activeCodexConversation =
    projectCodexConversations.find((conversation) => conversation.id === activeCodexConversationId) ??
    projectCodexConversations[0];
  const contentWidth = layout ? layout.width + canvasPaddingX * 2 : 0;
  const contentHeight = layout ? layout.height + canvasPaddingY * 2 : 0;
  const scaledWidth = contentWidth * zoom;
  const scaledHeight = contentHeight * zoom;
  const filteredProjects = useMemo(() => {
    const query = projectQuery.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) => {
      const searchable = [project.title, project.summary];
      Object.values(project.nodes).forEach((node) => searchable.push(node.text, node.note));
      return searchable.join(' ').toLowerCase().includes(query);
    });
  }, [projectQuery, projects]);

  useEffect(() => {
    if (!selectedProject) return;
    if (projectCodexConversations.length === 0) {
      setActiveCodexConversationId('');
      return;
    }
    if (!projectCodexConversations.some((conversation) => conversation.id === activeCodexConversationId)) {
      setActiveCodexConversationId(projectCodexConversations[0].id);
    }
  }, [activeCodexConversationId, projectCodexConversations, selectedProject]);

  function commitProjects(nextProjects: MindProject[]) {
    setProjects(nextProjects);
    saveProjects(nextProjects);
  }

  function trimCodexConversations(nextConversations: CodexConversation[], projectId: string) {
    const projectItems = nextConversations
      .filter((conversation) => conversation.projectId === projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const keepIds = new Set(projectItems.slice(0, maxCodexConversationsPerProject).map((conversation) => conversation.id));
    return nextConversations.filter(
      (conversation) => conversation.projectId !== projectId || keepIds.has(conversation.id)
    );
  }

  function commitCodexConversations(nextConversations: CodexConversation[]) {
    setCodexConversations(nextConversations);
    saveCodexConversations(nextConversations);
  }

  function createCodexConversation(projectId = selectedProject?.id) {
    if (!projectId) return null;
    const timestamp = new Date().toISOString();
    const conversation: CodexConversation = {
      id: createId('chat'),
      projectId,
      title: '新しい相談',
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const next = trimCodexConversations([conversation, ...codexConversations], projectId);
    commitCodexConversations(next);
    setActiveCodexConversationId(conversation.id);
    return conversation;
  }

  function deleteCodexConversation(conversationId: string) {
    const target = codexConversations.find((conversation) => conversation.id === conversationId);
    const next = codexConversations.filter((conversation) => conversation.id !== conversationId);
    commitCodexConversations(next);
    if (activeCodexConversationId === conversationId) {
      const fallback = next
        .filter((conversation) => conversation.projectId === target?.projectId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      setActiveCodexConversationId(fallback?.id ?? '');
    }
  }

  function updateCodexConversation(conversation: CodexConversation) {
    setCodexConversations((current) => {
      const exists = current.some((item) => item.id === conversation.id);
      const merged = exists
        ? current.map((item) => (item.id === conversation.id ? conversation : item))
        : [conversation, ...current];
      const next = trimCodexConversations(merged, conversation.projectId);
      saveCodexConversations(next);
      return next;
    });
  }

  function updateProject(mutator: (project: MindProject) => MindProject) {
    if (!selectedProject) return;
    const next = projects.map((project) =>
      project.id === selectedProject.id ? mutator(project) : project
    );
    commitProjects(next);
  }

  function openProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    setActiveProjectId(projectId);
    setSelectedNodeId(project.rootId);
  }

  function returnToHome() {
    setActiveProjectId('');
    setSelectedNodeId('');
    setQuickChildText('');
    setInspectorMode('edit');
  }

  function addProject() {
    const project = createProject(newProjectTitle || '新しい思考プロジェクト');
    const next = [project, ...projects];
    setNewProjectTitle('');
    commitProjects(next);
    setActiveProjectId(project.id);
    setSelectedNodeId(project.rootId);
  }

  function requestDeleteProject(projectId: string) {
    setPendingDeleteProjectId(projectId);
  }

  function cancelDeleteProject() {
    setPendingDeleteProjectId('');
  }

  function confirmDeleteProject() {
    if (!pendingDeleteProjectId) return;
    const next = projects.filter((project) => project.id !== pendingDeleteProjectId);
    commitProjects(next);
    if (activeProjectId === pendingDeleteProjectId) {
      setActiveProjectId('');
      setSelectedNodeId('');
    }
    setPendingDeleteProjectId('');
  }

  function updateSelectedNode(partial: Partial<MindNode>) {
    if (!selectedNode) return;
    updateProject((project) => {
      const nextNode = touchNode({ ...selectedNode, ...partial });
      return bumpProject({
        ...project,
        title: selectedNode.id === project.rootId ? nextNode.text : project.title,
        nodes: {
          ...project.nodes,
          [selectedNode.id]: nextNode,
        },
      });
    });
  }

  function findPosition(nodeId: string) {
    const positioned = layout?.nodes.find((node) => node.id === nodeId);
    const node = selectedProject?.nodes[nodeId];
    return {
      x: node?.position?.x ?? positioned?.x ?? 32,
      y: node?.position?.y ?? positioned?.y ?? 42,
    };
  }

  function editableTags(project = selectedProject) {
    return (project?.tags ?? defaultNodeTags).filter((tag) => tag.id !== 'theme');
  }

  function defaultChildKind(project = selectedProject) {
    return editableTags(project).find((tag) => tag.id !== 'memo')?.id ?? 'idea';
  }

  function rectsOverlap(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
    gap = 26
  ) {
    return !(
      a.x + a.width + gap < b.x ||
      b.x + b.width + gap < a.x ||
      a.y + a.height + gap < b.y ||
      b.y + b.height + gap < a.y
    );
  }

  function findOpenPosition(x: number, y: number, display: NodeDisplay = 'node', text = '') {
    const size = getNodeSize({ display, text });
    const existing =
      layout?.nodes.map((node) => {
        const nodeSize = getNodeSize(node);
        return { x: node.x, y: node.y, width: nodeSize.width, height: nodeSize.height };
      }) ?? [];

    const isOpen = (candidate: { x: number; y: number }) =>
      !existing.some((rect) => rectsOverlap({ ...candidate, width: size.width, height: size.height }, rect));

    const first = { x: Math.round(x), y: Math.round(y) };
    if (isOpen(first)) return first;

    for (let ring = 1; ring <= 12; ring += 1) {
      const horizontal = ring * 84;
      const vertical = ring * 64;
      const candidates = [
        { x: x + horizontal, y },
        { x: x + horizontal, y: y + vertical },
        { x: x + horizontal, y: y - vertical },
        { x, y: y + vertical },
        { x, y: y - vertical },
        { x: x - horizontal * 0.5, y: y + vertical },
        { x: x - horizontal * 0.5, y: y - vertical },
      ];
      const open = candidates.find((candidate) => isOpen(candidate));
      if (open) return { x: Math.round(open.x), y: Math.round(open.y) };
    }

    return { x: Math.round(x + childOffsetX), y: Math.round(y + childOffsetY) };
  }

  function findOpenPositionWithRects(
    x: number,
    y: number,
    display: NodeDisplay,
    text: string,
    existing: { x: number; y: number; width: number; height: number }[]
  ) {
    const size = getNodeSize({ display, text });
    const isOpen = (candidate: { x: number; y: number }) =>
      !existing.some((rect) => rectsOverlap({ ...candidate, width: size.width, height: size.height }, rect, 16));
    const place = (candidate: { x: number; y: number }) => {
      const position = { x: Math.round(candidate.x), y: Math.round(candidate.y) };
      existing.push({ ...position, width: size.width, height: size.height });
      return position;
    };

    const first = { x, y };
    if (isOpen(first)) return place(first);

    for (let ring = 1; ring <= 16; ring += 1) {
      const horizontal = ring * 86;
      const vertical = ring * 58;
      const candidates = [
        { x: x + horizontal * 0.35, y: y + vertical },
        { x: x + horizontal * 0.35, y: y - vertical },
        { x: x + horizontal, y },
        { x: x + horizontal, y: y + vertical },
        { x: x + horizontal, y: y - vertical },
        { x, y: y + vertical },
        { x, y: y - vertical },
      ];
      const open = candidates.find((candidate) => isOpen(candidate));
      if (open) return place(open);
    }

    return place({ x: x + childOffsetX, y: y + childOffsetY });
  }

  function findOpenBatchPositions(
    x: number,
    y: number,
    items: { display: NodeDisplay; text: string }[],
    existing: { x: number; y: number; width: number; height: number }[]
  ) {
    const gap = 16;
    const sizes = items.map((item) => getNodeSize(item));
    const totalHeight = sizes.reduce((sum, size) => sum + size.height, 0) + Math.max(0, sizes.length - 1) * gap;
    const minY = -canvasPaddingY + 180;
    const baseY = Math.max(minY, y - totalHeight / 2);

    const makeStack = (left: number, top: number) => {
      let cursorY = top;
      return sizes.map((size) => {
        const rect = { x: Math.round(left), y: Math.round(cursorY), width: size.width, height: size.height };
        cursorY += size.height + gap;
        return rect;
      });
    };

    const stackIsOpen = (stack: { x: number; y: number; width: number; height: number }[]) =>
      stack.every((rect) => !existing.some((occupied) => rectsOverlap(rect, occupied, 16)));

    const accept = (stack: { x: number; y: number; width: number; height: number }[]) => {
      existing.push(...stack);
      return stack.map(({ x: left, y: top }) => ({ x: left, y: top }));
    };

    for (let ring = 0; ring <= 10; ring += 1) {
      const candidates =
        ring === 0
          ? [{ dx: 0, dy: 0 }]
          : [
              { dx: ring * 72, dy: 0 },
              { dx: ring * 72, dy: ring * 56 },
              { dx: ring * 72, dy: -ring * 56 },
              { dx: 0, dy: ring * 64 },
              { dx: 0, dy: -ring * 64 },
            ];

      for (const candidate of candidates) {
        const stack = makeStack(x + candidate.dx, Math.max(minY, baseY + candidate.dy));
        if (stackIsOpen(stack)) return accept(stack);
      }
    }

    let cursorY = baseY;
    return items.map((item, index) => {
      const position = findOpenPositionWithRects(x + childOffsetX * 0.35, cursorY, item.display, item.text, existing);
      cursorY = position.y + sizes[index].height + gap;
      return position;
    });
  }

  function addChildToNode(
    parentId: string,
    text?: string,
    kind: NodeKind = defaultChildKind(),
    note = '',
    display: NodeDisplay = 'node'
  ) {
    const parentNode = selectedProject?.nodes[parentId];
    if (!parentNode) return;
    const child = createNode(text || quickChildText || (display === 'memo' ? 'メモを書く' : '新しい枝'), kind, 'user', display);
    const parentPosition = findPosition(parentId);
    const siblingCount = parentNode.children.length;
    child.note = note;
    child.position = findOpenPosition(
      parentPosition.x + childOffsetX,
      parentPosition.y + siblingCount * childOffsetY,
      display,
      child.text
    );
    updateProject((project) => {
      const parent = project.nodes[parentId];
      return bumpProject({
        ...project,
        nodes: {
          ...project.nodes,
          [parentId]: touchNode({ ...parent, children: [...parent.children, child.id] }),
          [child.id]: child,
        },
      });
    });
    setQuickChildText('');
    setSelectedNodeId(child.id);
  }

  function addChild(text?: string, kind: NodeKind = defaultChildKind()) {
    if (!selectedNode) return;
    addChildToNode(selectedNode.id, text, kind);
  }

  function addMemoBranch() {
    if (!selectedNode) return;
    addChildToNode(selectedNode.id, quickChildText || selectedNode.note || 'メモを書く', 'memo', '', 'memo');
  }

  function addCodexSuggestion(suggestion: CodexSuggestion) {
    if (!selectedProject) return;
    const parentId = selectedProject.nodes[suggestion.parentId] ? suggestion.parentId : selectedNode?.id;
    if (!parentId) return;
    addChildToNode(parentId, suggestion.text, suggestion.kind, suggestion.note, suggestion.display);
  }

  async function sendCodexMessage() {
    const text = codexDraft.trim();
    if (!text || !selectedProject || !selectedNode || codexStatus === 'loading') return;

    const timestamp = new Date().toISOString();
    const conversation = activeCodexConversation ?? createCodexConversation(selectedProject.id);
    if (!conversation) return;

    const userMessage: CodexChatMessage = {
      id: createId('msg'),
      role: 'user',
      text,
      createdAt: timestamp,
    };
    const baseTitle = conversation.messages.length === 0 ? compactText(text, 28) : conversation.title;
    const optimisticConversation: CodexConversation = {
      ...conversation,
      title: baseTitle || '新しい相談',
      messages: [...conversation.messages, userMessage],
      updatedAt: timestamp,
    };

    setCodexDraft('');
    setCodexStatus('loading');
    updateCodexConversation(optimisticConversation);

    let reply: { text: string; suggestions: CodexSuggestion[] };
    let usedLocal = false;
    try {
      reply = await generateCodexChatReply(
        selectedProject,
        selectedNode.id,
        text,
        optimisticConversation.messages,
        openAiKey
      );
    } catch {
      reply = createLocalCodexReply(selectedProject, selectedNode.id, text);
      usedLocal = true;
    }

    const assistantMessage: CodexChatMessage = {
      id: createId('msg'),
      role: 'assistant',
      text: reply.text,
      suggestions: reply.suggestions,
      createdAt: new Date().toISOString(),
    };
    const completedConversation: CodexConversation = {
      ...optimisticConversation,
      messages: [...optimisticConversation.messages, assistantMessage],
      updatedAt: assistantMessage.createdAt,
    };

    updateCodexConversation(completedConversation);
    setActiveCodexConversationId(completedConversation.id);
    setCodexStatus(usedLocal ? 'local' : 'idle');
    if (usedLocal && typeof window !== 'undefined') {
      window.setTimeout(() => setCodexStatus('idle'), 3200);
    }
  }

  function addAiBranch(nodeId: string) {
    if (!selectedProject) return;
    const parentNode = selectedProject.nodes[nodeId];
    if (!parentNode) return;
    const seed = createAssistantSeed(selectedProject, nodeId);
    const child = createNode(seed.text, seed.kind, 'ai');
    const parentPosition = findPosition(nodeId);
    child.note = seed.note;
    child.position = findOpenPosition(
      parentPosition.x + childOffsetX,
      parentPosition.y + (parentNode.children.length + 0.2) * childOffsetY,
      child.display,
      child.text
    );
    updateProject((project) => {
      const parent = project.nodes[nodeId];
      return bumpProject({
        ...project,
        nodes: {
          ...project.nodes,
          [nodeId]: touchNode({
            ...parent,
            hintCursor: parent.hintCursor + 1,
            children: [...parent.children, child.id],
          }),
          [child.id]: child,
        },
      });
    });
    setSelectedNodeId(child.id);
  }

  async function addAiMemoBatch(nodeId: string) {
    if (!selectedProject || aiBatchStatus === 'loading') return;
    const sourceProject = selectedProject;
    const parentNode = sourceProject.nodes[nodeId];
    if (!parentNode) return;

    setAiBatchStatus('loading');

    let memos: GeneratedMemo[] = [];
    let fallbackStatus: 'idle' | 'local' | 'fallback' = 'idle';
    try {
      memos = await generateResearchMemosWithOpenAI(sourceProject, nodeId, openAiKey);
    } catch {
      memos = createFallbackResearchMemos(sourceProject, nodeId);
      fallbackStatus = openAiKey.trim() ? 'fallback' : 'local';
    }

    const parentPosition = findPosition(nodeId);
    const occupied =
      layout?.nodes.map((node) => {
        const size = getNodeSize(node);
        return { x: node.x, y: node.y, width: size.width, height: size.height };
      }) ?? [];

    const memoTexts = memos.slice(0, 5).map(formatGeneratedMemo);
    const parentSize = getNodeSize(parentNode);
    const batchPositions = findOpenBatchPositions(
      parentPosition.x + childOffsetX + 64,
      parentPosition.y + parentSize.height / 2,
      memoTexts.map((text) => ({ display: 'memo' as NodeDisplay, text })),
      occupied
    );

    const createdNodes = memoTexts.map((text, index) => {
      const memo = memos[index];
      const child = createNode(text, 'memo', 'ai', 'memo');
      child.note = memo.body;
      child.position = batchPositions[index];
      return child;
    });

    if (createdNodes.length === 0) {
      setAiBatchStatus('error');
      return;
    }

    const nextProjects = projects.map((project) => {
      if (project.id !== sourceProject.id) return project;
      const parent = project.nodes[nodeId];
      if (!parent) return project;
      const nextNodes = { ...project.nodes };
      createdNodes.forEach((node) => {
        nextNodes[node.id] = node;
      });
      nextNodes[nodeId] = touchNode({
        ...parent,
        hintCursor: parent.hintCursor + createdNodes.length,
        children: [...parent.children, ...createdNodes.map((node) => node.id)],
      });
      return bumpProject({ ...project, nodes: nextNodes });
    });

    commitProjects(nextProjects);
    setSelectedNodeId(createdNodes[0].id);
    setAiBatchStatus(fallbackStatus);
    if (fallbackStatus !== 'idle' && typeof window !== 'undefined') {
      window.setTimeout(() => setAiBatchStatus('idle'), 4200);
    }
  }

  function addSibling() {
    if (!selectedProject || !selectedNode || selectedNode.id === selectedProject.rootId) return;
    const parentId = findParentId(selectedProject, selectedNode.id);
    if (!parentId) return;
    const sibling = createNode('同じ階層の新しい枝', defaultChildKind(), 'user');
    const selectedPosition = findPosition(selectedNode.id);
    sibling.position = findOpenPosition(selectedPosition.x, selectedPosition.y + childOffsetY, sibling.display, sibling.text);
    updateProject((project) => {
      const parent = project.nodes[parentId];
      const index = parent.children.indexOf(selectedNode.id);
      const children = [...parent.children];
      children.splice(index + 1, 0, sibling.id);
      return bumpProject({
        ...project,
        nodes: {
          ...project.nodes,
          [parentId]: touchNode({ ...parent, children }),
          [sibling.id]: sibling,
        },
      });
    });
    setSelectedNodeId(sibling.id);
  }

  function deleteNode(nodeId: string) {
    if (!selectedProject || nodeId === selectedProject.rootId) return;
    const parentId = findParentId(selectedProject, nodeId);
    if (!parentId) return;
    const removeIds = new Set(getDescendantIds(selectedProject, nodeId));
    updateProject((project) => {
      const nodes = { ...project.nodes };
      removeIds.forEach((id) => delete nodes[id]);
      const parent = project.nodes[parentId];
      return bumpProject({
        ...project,
        nodes: {
          ...nodes,
          [parentId]: touchNode({
            ...parent,
            children: parent.children.filter((id) => id !== nodeId),
          }),
        },
      });
    });
    if (removeIds.has(selectedNode?.id ?? '')) {
      setSelectedNodeId(parentId);
    }
  }

  function deleteSelectedNode() {
    if (!selectedNode) return;
    deleteNode(selectedNode.id);
  }

  function resetNodePositions() {
    updateProject((project) => {
      const nodes = Object.fromEntries(
        Object.entries(project.nodes).map(([id, node]) => [
          id,
          touchNode({
            ...node,
            position: undefined,
          }),
        ])
      );
      return bumpProject({ ...project, nodes });
    });
  }

  function updateTag(tagId: string, partial: Partial<NodeTag>) {
    updateProject((project) =>
      bumpProject({
        ...project,
        tags: project.tags.map((tag) => (tag.id === tagId ? { ...tag, ...partial } : tag)),
      })
    );
  }

  function addTag() {
    const label = newTagLabel.trim();
    if (!label) return;
    const color = tagColorOptions[(selectedProject?.tags.length ?? 0) % tagColorOptions.length];
    const tag = { id: createId('tag'), label, color };
    updateProject((project) => bumpProject({ ...project, tags: [...project.tags, tag] }));
    setNewTagLabel('');
  }

  function renameProjectTitle(text: string) {
    updateProject((project) =>
      bumpProject({
        ...project,
        title: text,
        nodes: {
          ...project.nodes,
          [project.rootId]: touchNode({ ...project.nodes[project.rootId], text }),
        },
      })
    );
  }

  function moveNode(nodeId: string, x: number, y: number) {
    updateProject((project) => {
      const node = project.nodes[nodeId];
      if (!node) return project;
      return bumpProject({
        ...project,
        nodes: {
          ...project.nodes,
          [nodeId]: touchNode({
            ...node,
            position: {
              x: Math.max(-canvasPaddingX + 120, Math.round(x)),
              y: Math.max(-canvasPaddingY + 120, Math.round(y)),
            },
          }),
        },
      });
    });
  }

  function beginDrag(event: GestureResponderEvent, nodeId: string) {
    event.stopPropagation();
    const position = findPosition(nodeId);
    dragRef.current = {
      nodeId,
      startPageX: event.nativeEvent.pageX,
      startPageY: event.nativeEvent.pageY,
      startX: position.x,
      startY: position.y,
      moved: false,
    };
    setDraggingNodeId(nodeId);
    setSelectedNodeId(nodeId);
  }

  function updateDrag(event: GestureResponderEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const nextX = drag.startX + (event.nativeEvent.pageX - drag.startPageX) / zoom;
    const nextY = drag.startY + (event.nativeEvent.pageY - drag.startPageY) / zoom;
    drag.moved = true;
    moveNode(drag.nodeId, nextX, nextY);
  }

  function endDrag() {
    dragRef.current = null;
    setDraggingNodeId(null);
  }

  function beginCanvasPan(event: GestureResponderEvent) {
    const node = canvasScrollerRef.current;
    if (!node) return;
    panRef.current = {
      startPageX: event.nativeEvent.pageX,
      startPageY: event.nativeEvent.pageY,
      startScrollLeft: node.scrollLeft ?? 0,
      startScrollTop: node.scrollTop ?? 0,
    };
    setPanningCanvas(true);
  }

  function updateCanvasPan(event: GestureResponderEvent) {
    const pan = panRef.current;
    const node = canvasScrollerRef.current;
    if (!pan || !node) return;
    node.scrollLeft = pan.startScrollLeft - (event.nativeEvent.pageX - pan.startPageX) * canvasDragPanSensitivity;
    node.scrollTop = pan.startScrollTop - (event.nativeEvent.pageY - pan.startPageY) * canvasDragPanSensitivity;
  }

  function endCanvasPan() {
    panRef.current = null;
    setPanningCanvas(false);
  }

  function startResize(panel: 'sidebar' | 'inspector', event: GestureResponderEvent) {
    if (Platform.OS !== 'web') return;
    event.stopPropagation();
    resizeRef.current = {
      panel,
      startX: event.nativeEvent.pageX,
      startWidth: panel === 'sidebar' ? sidebarWidth : inspectorWidth,
    };
  }

  function getScrollerMetrics() {
    if (Platform.OS !== 'web') return null;
    const node = canvasScrollerRef.current;
    if (!node) return null;
    return {
      scrollLeft: node.scrollLeft ?? 0,
      scrollTop: node.scrollTop ?? 0,
      clientWidth: node.clientWidth ?? 0,
      clientHeight: node.clientHeight ?? 0,
    };
  }

  function applyZoom(nextZoom: number, focus?: { x: number; y: number }) {
    const clamped = clampZoom(nextZoom);
    const metrics = getScrollerMetrics();
    const previousZoom = zoomRef.current;

    if (!metrics || previousZoom === clamped || typeof window === 'undefined') {
      zoomRef.current = clamped;
      setZoom(clamped);
      return;
    }

    zoomRef.current = clamped;

    const focusX = focus?.x ?? metrics.clientWidth / 2;
    const focusY = focus?.y ?? metrics.clientHeight / 2;
    const currentLeft = pendingZoomScrollRef.current?.left ?? metrics.scrollLeft;
    const currentTop = pendingZoomScrollRef.current?.top ?? metrics.scrollTop;
    const contentX = (currentLeft + focusX) / previousZoom;
    const contentY = (currentTop + focusY) / previousZoom;

    pendingZoomScrollRef.current = {
      left: Math.max(0, contentX * clamped - focusX),
      top: Math.max(0, contentY * clamped - focusY),
    };
    setZoom(clamped);
  }

  useEffect(() => {
    applyZoomRef.current = applyZoom;
  });

  function scheduleWheelZoom(multiplier: number, focus: { x: number; y: number }) {
    if (typeof window === 'undefined') return;
    const pending = wheelZoomRef.current;
    pending.multiplier *= multiplier;
    pending.focus = focus;

    if (pending.frame !== null) return;
    pending.frame = window.requestAnimationFrame(() => {
      const { multiplier: zoomMultiplier, focus: zoomFocus } = wheelZoomRef.current;
      wheelZoomRef.current.frame = null;
      wheelZoomRef.current.multiplier = 1;
      applyZoomRef.current(clampZoom(zoomRef.current * zoomMultiplier), zoomFocus);
    });
  }

  function fitToCanvas() {
    if (!layout) return;
    const metrics = getScrollerMetrics();
    if (!metrics) {
      applyZoom(1);
      return;
    }

    const nextZoom = clampZoom(
      Math.min(
        (metrics.clientWidth - fitPadding) / contentWidth,
        (metrics.clientHeight - fitPadding) / contentHeight
      )
    );
    zoomRef.current = nextZoom;
    pendingZoomScrollRef.current = {
      left: Math.max(0, (contentWidth * nextZoom - metrics.clientWidth) / 2),
      top: Math.max(0, (contentHeight * nextZoom - metrics.clientHeight) / 2),
    };
    setZoom(nextZoom);

  }

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !activeProjectId) return;

    window.requestAnimationFrame(() => {
      const node = canvasScrollerRef.current;
      if (!node) return;
      node.scrollLeft = Math.max(0, canvasPaddingX * zoomRef.current * 0.55);
      node.scrollTop = Math.max(0, canvasPaddingY * zoomRef.current * 0.58);
    });
  }, [activeProjectId]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || compact) return;

    const node = canvasScrollerRef.current as HTMLElement | null;
    if (!node) return;
    const wheelZoomState = wheelZoomRef.current;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;

      event.preventDefault();
      const rect = node.getBoundingClientRect();
      scheduleWheelZoom(Math.exp(-event.deltaY * trackpadZoomSensitivity), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };

    const beginGestureZoom = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { clientX?: number; clientY?: number };
      const rect = node.getBoundingClientRect();
      gestureZoomRef.current = {
        startZoom: zoomRef.current,
        focus: {
          x: (gesture.clientX ?? rect.left + rect.width / 2) - rect.left,
          y: (gesture.clientY ?? rect.top + rect.height / 2) - rect.top,
        },
      };
    };

    const updateGestureZoom = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale?: number };
      const state = gestureZoomRef.current;
      if (!state) return;
      applyZoomRef.current(state.startZoom * (gesture.scale ?? 1), state.focus);
    };

    const endGestureZoom = (event: Event) => {
      event.preventDefault();
      gestureZoomRef.current = null;
    };

    node.addEventListener('wheel', handleWheel, { passive: false });
    node.addEventListener('gesturestart', beginGestureZoom, { passive: false } as AddEventListenerOptions);
    node.addEventListener('gesturechange', updateGestureZoom, { passive: false } as AddEventListenerOptions);
    node.addEventListener('gestureend', endGestureZoom, { passive: false } as AddEventListenerOptions);

    return () => {
      node.removeEventListener('wheel', handleWheel);
      node.removeEventListener('gesturestart', beginGestureZoom as EventListener);
      node.removeEventListener('gesturechange', updateGestureZoom as EventListener);
      node.removeEventListener('gestureend', endGestureZoom as EventListener);
      if (wheelZoomState.frame !== null) {
        window.cancelAnimationFrame(wheelZoomState.frame);
        wheelZoomState.frame = null;
        wheelZoomState.multiplier = 1;
      }
    };
  }, [compact]);

  function renderProjectHub() {
    return (
      <View style={styles.homeShell}>
        <ScrollView contentContainerStyle={[styles.homeContent, compact && styles.homeContentCompact]}>
          <View style={styles.homeHero}>
            <View style={styles.homeHeroCopy}>
              <View style={styles.homeBrandRow}>
                <View style={styles.brandMark}>
                  <Feather name="git-branch" size={18} color="#F8FAFC" />
                </View>
                <View>
                  <Text style={styles.homeBrandTitle}>Assisted Mindmap</Text>
                  <Text style={styles.homeBrandSub}>project hub</Text>
                </View>
              </View>
              <Text style={styles.homeTitle}>テーマを選んで、考える場所を開く。</Text>
              <Text style={styles.homeDescription}>
                プロジェクトごとに思考を分けて、必要なときにAIの補助で枝を伸ばせます。
              </Text>
            </View>
          </View>

          <View style={styles.homeCommandBar}>
            <View style={[styles.homeCreateGroup, compact && styles.homeCreateGroupCompact]}>
              <Feather name="plus-circle" size={18} color="#2563EB" />
              <TextInput
                value={newProjectTitle}
                onChangeText={setNewProjectTitle}
                placeholder="新しいテーマ"
                placeholderTextColor="#8A93A3"
                style={styles.homeCreateInput}
                onSubmitEditing={addProject}
              />
              <Pressable style={styles.primaryButtonWide} onPress={addProject}>
                <Text style={styles.primaryButtonText}>作成して開く</Text>
              </Pressable>
            </View>

            <View style={[styles.homeSearch, compact && styles.homeSearchCompact]}>
              <Feather name="search" size={16} color="#64748B" />
              <TextInput
                value={projectQuery}
                onChangeText={setProjectQuery}
                placeholder="プロジェクトを検索"
                placeholderTextColor="#94A3B8"
                style={[styles.homeSearchInput, webNoFocusRingStyle]}
              />
            </View>
          </View>

          <View style={styles.homeSectionHeader}>
            <View>
              <Text style={styles.homeSectionTitle}>プロジェクト一覧</Text>
              <Text style={styles.homeSectionMeta}>{projects.length} projects</Text>
            </View>
          </View>

          {filteredProjects.length > 0 ? (
            <View style={styles.homeGrid}>
              {filteredProjects.map((project) => {
                const aiCount = Object.values(project.nodes).filter((node) => node.author === 'ai').length;
                return (
                  <Pressable key={project.id} onPress={() => openProject(project.id)} style={styles.homeProjectCard}>
                    <Pressable
                      accessibilityLabel={`${project.title}を削除`}
                      onPress={(event: GestureResponderEvent) => {
                        event.stopPropagation();
                        requestDeleteProject(project.id);
                      }}
                      style={styles.homeProjectDeleteButton}>
                      <Feather name="trash-2" size={14} color="#B91C1C" />
                    </Pressable>
                    <View style={styles.homeProjectCardHeader}>
                      <Text style={styles.homeProjectTitle} numberOfLines={2}>
                        {project.title}
                      </Text>
                      <View style={styles.homeProjectOpenIcon}>
                        <Feather name="arrow-up-right" size={16} color="#2563EB" />
                      </View>
                    </View>
                    <Text style={styles.homeProjectSummary} numberOfLines={3}>
                      {project.summary || 'まだ概要はありません。'}
                    </Text>
                    <View style={styles.homeProjectMetaRow}>
                      <Text style={styles.homeProjectMeta}>{Object.keys(project.nodes).length} nodes</Text>
                      <Text style={styles.homeProjectMeta}>{aiCount} AI nodes</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View style={styles.homeEmptyState}>
              <Text style={styles.homeEmptyTitle}>一致するプロジェクトがありません</Text>
              <Text style={styles.homeEmptyText}>タイトル、概要、ノード本文、メモから検索しています。</Text>
            </View>
          )}
        </ScrollView>
        <Modal
          transparent
          visible={Boolean(pendingDeleteProject)}
          animationType="fade"
          onRequestClose={cancelDeleteProject}>
          <View style={styles.confirmOverlay}>
            <View style={styles.confirmDialog}>
              <View style={styles.confirmIcon}>
                <Feather name="trash-2" size={20} color="#B91C1C" />
              </View>
              <Text style={styles.confirmTitle}>本当に削除しますか？</Text>
              <Text style={styles.confirmText}>
                {pendingDeleteProject?.title ?? 'このプロジェクト'}を削除すると、ノードとメモもすべて消えます。
              </Text>
              <View style={styles.confirmActions}>
                <Pressable style={styles.confirmCancelButton} onPress={cancelDeleteProject}>
                  <Text style={styles.confirmCancelText}>キャンセル</Text>
                </Pressable>
                <Pressable style={styles.confirmDeleteButton} onPress={confirmDeleteProject}>
                  <Text style={styles.confirmDeleteText}>削除する</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  function renderCanvasSurface() {
    if (!layout) return null;

    const canvasChildren = (
      <View
        style={[
          styles.canvasWorld,
          panningCanvas && styles.canvasWorldPanning,
          {
            width: contentWidth,
            height: contentHeight,
            transformOrigin: 'top left',
            transform: [{ scale: zoom }],
          } as object,
        ]}>
        <View
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={beginCanvasPan}
          onResponderMove={updateCanvasPan}
          onResponderRelease={endCanvasPan}
          onResponderTerminate={endCanvasPan}
          style={[
            styles.canvasPanSurface,
            Platform.OS === 'web' && (panningCanvas ? webGrabbingCursorStyle : webGrabCursorStyle),
          ]}
        />
        <ConnectorLayer
          width={contentWidth}
          height={contentHeight}
          offsetX={canvasPaddingX}
          offsetY={canvasPaddingY}
          edges={layout.edges}
        />
        {layout.nodes.map((node) => {
          const size = getNodeSize(node);
          const tagColor = kindColor(selectedProject?.tags, node.kind);
          const isMemo = node.display === 'memo';
          return (
            <Pressable
              key={node.id}
              onPress={() => setSelectedNodeId(node.id)}
              onHoverIn={() => setHoveredNodeId(node.id)}
              onHoverOut={() => setHoveredNodeId((current) => (current === node.id ? null : current))}
              style={[
                styles.mindNode,
                isMemo && styles.memoNode,
                webNodeNoSelectStyle,
                {
                  left: canvasPaddingX + node.x,
                  top: canvasPaddingY + node.y,
                  width: size.width,
                  minHeight: isMemo ? undefined : size.height,
                  height: isMemo ? size.height : undefined,
                  backgroundColor: isMemo ? 'transparent' : authorPalette(node.author).background,
                  borderColor: isMemo
                    ? 'transparent'
                    : node.id === selectedNode?.id
                      ? tagColor
                      : authorPalette(node.author).border,
                },
                node.id === selectedNode?.id && !isMemo && styles.mindNodeSelected,
                draggingNodeId === node.id && styles.mindNodeDragging,
              ]}>
              {[
                styles.nodeDragTop,
                styles.nodeDragRight,
                styles.nodeDragBottom,
                styles.nodeDragLeft,
              ].map((style, index) => (
                <View
                  key={index}
                  accessibilityLabel="ノードの枠をドラッグ"
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={(event) => beginDrag(event, node.id)}
                  onResponderMove={updateDrag}
                  onResponderRelease={endDrag}
                  onResponderTerminate={endDrag}
                  style={[styles.nodeBorderDragHandle, style, webMoveCursorStyle]}
                />
              ))}
              {!isMemo ? (
                <View style={styles.nodeHeader}>
                  <View style={styles.nodeKindGroup}>
                    <View style={[styles.kindDot, { backgroundColor: tagColor }]} />
                    <Text style={styles.nodeKind}>{kindLabel(selectedProject?.tags, node.kind)}</Text>
                    <View
                      style={[
                        styles.authorBadge,
                        { backgroundColor: authorPalette(node.author).badgeBackground },
                      ]}>
                      <Text style={[styles.authorBadgeText, { color: authorPalette(node.author).badgeText }]}>
                        {authorLabel(node.author)}
                      </Text>
                    </View>
                  </View>
                </View>
              ) : null}
              {hoveredNodeId === node.id && node.id !== selectedProject?.rootId ? (
                <Pressable
                  accessibilityLabel="ノードを削除"
                  onPress={(event: GestureResponderEvent) => {
                    event.stopPropagation();
                    deleteNode(node.id);
                  }}
                  style={[styles.nodeHoverDeleteButton, isMemo && styles.memoHoverDeleteButton]}>
                  <Feather name="trash-2" size={13} color="#B91C1C" />
                </Pressable>
              ) : null}
              {isMemo ? (
                <View style={styles.memoInline}>
                  <Text style={styles.memoText}>{node.text}</Text>
                  <View style={styles.memoUnderline} />
                </View>
              ) : (
                <Text style={styles.nodeText} numberOfLines={2}>
                  {node.text}
                </Text>
              )}
              {!isMemo && node.note ? (
                <Text style={styles.nodeNote} numberOfLines={1}>
                  {node.note}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    );

    if (Platform.OS === 'web') {
      return (
        <View ref={canvasScrollerRef} style={[styles.canvasViewport, webCanvasViewportStyle]}>
          <View style={{ width: scaledWidth, height: scaledHeight }}>{canvasChildren}</View>
        </View>
      );
    }

    return (
      <ScrollView
        style={styles.canvasViewport}
        contentContainerStyle={{ width: scaledWidth, height: scaledHeight }}
        horizontal
        scrollEnabled={!draggingNodeId}
        nestedScrollEnabled>
        <ScrollView
          contentContainerStyle={{ width: scaledWidth, height: scaledHeight }}
          scrollEnabled={!draggingNodeId}>
          {canvasChildren}
        </ScrollView>
      </ScrollView>
    );
  }

  if (!selectedProject || !layout || !selectedNode) {
    return renderProjectHub();
  }

  return (
    <View style={[styles.app, compact && styles.appCompact]}>
      <View style={[styles.sidebar, !compact && { width: sidebarWidth }, compact && styles.sidebarCompact]}>
        <View style={styles.sidebarTopRow}>
          <Pressable style={styles.sidebarHomeButton} onPress={returnToHome}>
            <Feather name="home" size={16} color="#F8FAFC" />
            <Text style={styles.sidebarHomeText}>Home</Text>
          </Pressable>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Feather name="git-branch" size={18} color="#F8FAFC" />
            </View>
            <View>
              <Text style={styles.brandTitle}>Assisted Mindmap</Text>
              <Text style={styles.brandSub}>local thinking workspace</Text>
            </View>
          </View>
        </View>

        <View style={styles.createBox}>
          <TextInput
            value={newProjectTitle}
            onChangeText={setNewProjectTitle}
            placeholder="新しいテーマ"
            placeholderTextColor="#8A93A3"
            style={styles.projectInput}
            onSubmitEditing={addProject}
          />
          <Pressable style={styles.iconButtonDark} onPress={addProject}>
            <Feather name="plus" size={18} color="#F8FAFC" />
          </Pressable>
        </View>

        <View style={styles.sidebarSearch}>
          <Feather name="search" size={15} color="#8FA0B5" />
          <TextInput
            value={projectQuery}
            onChangeText={setProjectQuery}
            placeholder="プロジェクト検索"
            placeholderTextColor="#8A93A3"
            style={[styles.sidebarSearchInput, webNoFocusRingStyle]}
          />
        </View>

        <ScrollView
          style={styles.projectList}
          contentContainerStyle={[styles.projectListContent, compact && styles.projectListContentCompact]}>
          {filteredProjects.map((project) => {
            const active = project.id === selectedProject.id;
            return (
              <Pressable
                key={project.id}
                onPress={() => openProject(project.id)}
                style={[styles.projectItem, active && styles.projectItemActive]}>
                <Text style={[styles.projectTitle, active && styles.projectTitleActive]} numberOfLines={1}>
                  {project.title}
                </Text>
                <Text style={styles.projectSummary} numberOfLines={2}>
                  {project.summary || `${Object.keys(project.nodes).length} nodes`}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {!compact ? <ResizeHandle onStart={(event) => startResize('sidebar', event)} /> : null}

      <View style={styles.workspace}>
        <View style={[styles.topbar, compact && styles.topbarCompact]}>
          <View style={styles.titleEditGroup}>
            <TextInput
              value={selectedProject.title}
              onChangeText={renameProjectTitle}
              style={[styles.projectTitleInput, compact && styles.projectTitleInputCompact]}
            />
            <TextInput
              value={selectedProject.summary}
              onChangeText={(summary) => updateProject((project) => bumpProject({ ...project, summary }))}
              placeholder="このプロジェクトの目的・メモ"
              placeholderTextColor="#8A93A3"
              style={styles.summaryInput}
            />
          </View>
          <View style={[styles.topbarStats, compact && styles.topbarStatsCompact]}>
            <Feather name="layers" size={16} color="#4B5563" />
            <Text style={styles.statText}>{Object.keys(selectedProject.nodes).length} nodes</Text>
          </View>
        </View>

        <View style={[styles.body, compact && styles.bodyCompact]}>
          <View style={[styles.canvasArea, compact && styles.canvasAreaCompact]}>
            <View style={[styles.zoomControls, compact && styles.zoomControlsCompact]}>
              <Pressable
                accessibilityLabel="全体表示"
                onPress={fitToCanvas}
                style={styles.zoomFitButton}>
                <Feather name="maximize-2" size={14} color="#0F172A" />
                <Text style={styles.zoomFitText}>Fit</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="位置をリセット"
                onPress={resetNodePositions}
                style={styles.zoomButton}>
                <Feather name="rotate-ccw" size={15} color="#111827" />
              </Pressable>
              <Pressable
                accessibilityLabel="ズームアウト"
                onPress={() => applyZoom(zoom - 0.06)}
                style={styles.zoomButton}>
                <Feather name="minus" size={16} color="#111827" />
              </Pressable>
              <Pressable
                accessibilityLabel="ズームをリセット"
                onPress={() => applyZoom(1)}
                style={styles.zoomValueButton}>
                <Text style={styles.zoomValueText}>{Math.round(zoom * 100)}%</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="ズームイン"
                onPress={() => applyZoom(zoom + 0.06)}
                style={styles.zoomButton}>
                <Feather name="plus" size={16} color="#111827" />
              </Pressable>
            </View>
            {renderCanvasSurface()}
          </View>

          {!compact ? <ResizeHandle onStart={(event) => startResize('inspector', event)} /> : null}

          <View
            style={[
              styles.inspector,
              !compact && { width: inspectorWidth },
              compact && styles.inspectorCompact,
            ]}>
            <ScrollView contentContainerStyle={styles.inspectorContent}>
              <View style={styles.pathBar}>
                {selectedPath.map((node, index) => (
                  <Text key={node.id} style={styles.pathText} numberOfLines={1}>
                    {index > 0 ? ' / ' : ''}
                    {node.text}
                  </Text>
                ))}
              </View>

              <View style={styles.inspectorModeRow}>
                <Pressable
                  onPress={() => setInspectorMode('edit')}
                  style={[styles.inspectorModeButton, inspectorMode === 'edit' && styles.inspectorModeButtonActive]}>
                  <Feather name="edit-3" size={14} color={inspectorMode === 'edit' ? '#FFFFFF' : '#334155'} />
                  <Text style={[styles.inspectorModeText, inspectorMode === 'edit' && styles.inspectorModeTextActive]}>
                    編集
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setInspectorMode('codex')}
                  style={[styles.inspectorModeButton, inspectorMode === 'codex' && styles.inspectorModeButtonActive]}>
                  <Feather name="message-square" size={14} color={inspectorMode === 'codex' ? '#FFFFFF' : '#334155'} />
                  <Text style={[styles.inspectorModeText, inspectorMode === 'codex' && styles.inspectorModeTextActive]}>
                    Codex
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setInspectorMode('settings')}
                  style={[styles.inspectorModeButton, inspectorMode === 'settings' && styles.inspectorModeButtonActive]}>
                  <Feather name="settings" size={14} color={inspectorMode === 'settings' ? '#FFFFFF' : '#334155'} />
                  <Text
                    style={[
                      styles.inspectorModeText,
                      inspectorMode === 'settings' && styles.inspectorModeTextActive,
                    ]}>
                    設定
                  </Text>
                </Pressable>
              </View>

              {inspectorMode === 'edit' ? (
                <>
                  <Text style={styles.panelLabel}>選択中の枝</Text>
                  <TextInput
                    value={selectedNode.text}
                    onChangeText={(text) => updateSelectedNode({ text })}
                    multiline
                    style={styles.nodeInput}
                  />

                  <View style={styles.kindRow}>
                    {editableTags().map((tag) => (
                      <Pressable
                        key={tag.id}
                        onPress={() => updateSelectedNode({ kind: tag.id })}
                        style={[
                          styles.kindButton,
                          selectedNode.kind === tag.id && { backgroundColor: tag.color, borderColor: tag.color },
                        ]}>
                        <Text
                          style={[styles.kindButtonText, selectedNode.kind === tag.id && styles.kindButtonTextActive]}>
                          {tag.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <View style={styles.displayRow}>
                    {(['node', 'memo'] as NodeDisplay[]).map((display) => (
                      <Pressable
                        key={display}
                        onPress={() =>
                          updateSelectedNode({ display, kind: display === 'memo' ? 'memo' : selectedNode.kind })
                        }
                        style={[styles.displayButton, selectedNode.display === display && styles.displayButtonActive]}>
                        <Text
                          style={[
                            styles.displayButtonText,
                            selectedNode.display === display && styles.displayButtonTextActive,
                          ]}>
                          {display === 'memo' ? 'メモ表示' : 'ノード表示'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <TextInput
                    value={selectedNode.note}
                    onChangeText={(note) => updateSelectedNode({ note })}
                    multiline
                    placeholder="補足メモ、根拠、リンクなど"
                    placeholderTextColor="#8A93A3"
                    style={styles.noteInput}
                  />

                  <View style={styles.actionGrid}>
                    <ActionButton icon="corner-down-right" label="子を追加" onPress={() => addChild()} />
                    <ActionButton
                      icon="plus-square"
                      label="同階層"
                      onPress={addSibling}
                      disabled={selectedNode.id === selectedProject.rootId}
                    />
                    <ActionButton icon="zap" label="AIで1件" onPress={() => addAiBranch(selectedNode.id)} />
                    <ActionButton
                      icon="cpu"
                      label={aiBatchStatus === 'loading' ? '生成中' : 'AI深掘り5件'}
                      onPress={() => addAiMemoBatch(selectedNode.id)}
                      disabled={aiBatchStatus === 'loading'}
                    />
                    <ActionButton icon="file-text" label="メモ追加" onPress={addMemoBranch} />
                    <ActionButton icon="rotate-ccw" label="位置リセット" onPress={resetNodePositions} />
                    <ActionButton
                      icon="trash-2"
                      label="削除"
                      onPress={deleteSelectedNode}
                      danger
                      disabled={selectedNode.id === selectedProject.rootId}
                    />
                  </View>
                  {aiBatchStatus !== 'idle' ? (
                    <Text style={[styles.aiBatchStatus, aiBatchStatus === 'error' && styles.aiBatchStatusError]}>
                      {aiBatchStatus === 'loading'
                        ? `${AI_BATCH_MODEL}で調査メモを生成しています`
                        : aiBatchStatus === 'local'
                          ? 'APIキー未設定のため、ローカル候補で深掘りしました'
                          : aiBatchStatus === 'fallback'
                          ? 'API生成に失敗したため、ローカル候補で深掘りしました'
                          : 'AI深掘りを生成できませんでした'}
                    </Text>
                  ) : null}

                  <View style={styles.quickAdd}>
                    <TextInput
                      value={quickChildText}
                      onChangeText={setQuickChildText}
                      placeholder="この枝から伸ばす内容を書く"
                      placeholderTextColor="#8A93A3"
                      style={styles.quickAddInput}
                      onSubmitEditing={() => addChild()}
                    />
                    <Pressable style={styles.primaryButton} onPress={() => addChild()}>
                      <Text style={styles.primaryButtonText}>追加</Text>
                    </Pressable>
                  </View>
                </>
              ) : inspectorMode === 'codex' ? (
                <View style={styles.codexPanel}>
                  <View style={styles.codexHeader}>
                    <View>
                      <Text style={styles.panelLabel}>Codex相談</Text>
                      <Text style={styles.codexSubText}>選択中: {selectedNode.text}</Text>
                    </View>
                    <Pressable style={styles.codexNewButton} onPress={() => createCodexConversation()}>
                      <Feather name="plus" size={14} color="#FFFFFF" />
                      <Text style={styles.codexNewButtonText}>新規</Text>
                    </Pressable>
                  </View>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.codexConversationList}>
                    {projectCodexConversations.length === 0 ? (
                      <Pressable style={[styles.codexConversationChip, styles.codexConversationChipActive]}>
                        <Text style={[styles.codexConversationText, styles.codexConversationTextActive]}>
                          新しい相談
                        </Text>
                      </Pressable>
                    ) : (
                      projectCodexConversations.map((conversation) => {
                        const active = conversation.id === activeCodexConversation?.id;
                        return (
                          <Pressable
                            key={conversation.id}
                            onPress={() => setActiveCodexConversationId(conversation.id)}
                            style={[styles.codexConversationChip, active && styles.codexConversationChipActive]}>
                            <Text
                              style={[styles.codexConversationText, active && styles.codexConversationTextActive]}
                              numberOfLines={1}>
                              {conversation.title}
                            </Text>
                            <Pressable
                              accessibilityLabel={`${conversation.title}を削除`}
                              onPress={(event: GestureResponderEvent) => {
                                event.stopPropagation();
                                deleteCodexConversation(conversation.id);
                              }}
                              style={styles.codexConversationDelete}>
                              <Feather name="x" size={12} color={active ? '#FFFFFF' : '#64748B'} />
                            </Pressable>
                          </Pressable>
                        );
                      })
                    )}
                  </ScrollView>

                  <View style={styles.codexMessages}>
                    {activeCodexConversation?.messages.length ? (
                      activeCodexConversation.messages.map((message) => (
                        <View
                          key={message.id}
                          style={[
                            styles.codexMessage,
                            message.role === 'user' ? styles.codexUserMessage : styles.codexAssistantMessage,
                          ]}>
                          <Text style={styles.codexMessageRole}>{message.role === 'user' ? 'You' : 'Codex'}</Text>
                          <Text style={styles.codexMessageText}>{message.text}</Text>
                          {message.suggestions?.length ? (
                            <View style={styles.codexSuggestionList}>
                              {message.suggestions.map((suggestion) => (
                                <Pressable
                                  key={suggestion.id}
                                  onPress={() => addCodexSuggestion(suggestion)}
                                  style={styles.codexSuggestionCard}>
                                  <View style={styles.codexSuggestionTop}>
                                    <Feather
                                      name={suggestion.display === 'memo' ? 'file-text' : 'corner-down-right'}
                                      size={13}
                                      color="#2563EB"
                                    />
                                    <Text style={styles.codexSuggestionTitle}>{suggestion.title}</Text>
                                  </View>
                                  <Text style={styles.codexSuggestionText} numberOfLines={2}>
                                    {suggestion.text}
                                  </Text>
                                  <Text style={styles.codexSuggestionAction}>この枝を追加</Text>
                                </Pressable>
                              ))}
                            </View>
                          ) : null}
                        </View>
                      ))
                    ) : (
                      <View style={styles.codexEmptyState}>
                        <Feather name="message-circle" size={22} color="#2563EB" />
                        <Text style={styles.codexEmptyTitle}>このツリーについて相談</Text>
                        <Text style={styles.codexEmptyText}>
                          今どこで迷っているかを書くと、選択中ノードから次に伸ばす候補を出します。
                        </Text>
                      </View>
                    )}
                    {codexStatus === 'loading' ? (
                      <Text style={styles.codexStatusText}>Codexが考えています</Text>
                    ) : codexStatus === 'local' ? (
                      <Text style={styles.codexStatusText}>APIキー未設定のため、ローカル候補で返答しました</Text>
                    ) : codexStatus === 'error' ? (
                      <Text style={[styles.codexStatusText, styles.aiBatchStatusError]}>
                        返答を作れませんでした
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.codexComposer}>
                    <TextInput
                      value={codexDraft}
                      onChangeText={setCodexDraft}
                      placeholder="例: この辺のノードで迷ってる。次どこを広げるべき？"
                      placeholderTextColor="#8A93A3"
                      multiline
                      style={styles.codexComposerInput}
                    />
                    <Pressable
                      style={[styles.codexSendButton, codexStatus === 'loading' && styles.actionButtonDisabled]}
                      disabled={codexStatus === 'loading'}
                      onPress={sendCodexMessage}>
                      <Feather name="send" size={16} color="#FFFFFF" />
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.tagEditor}>
                  <View style={styles.settingsSection}>
                    <Text style={styles.panelLabel}>AI深掘り設定</Text>
                    <TextInput
                      value={openAiKey}
                      onChangeText={setOpenAiKey}
                      placeholder="OpenAI API key"
                      placeholderTextColor="#8A93A3"
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={styles.apiKeyInput}
                    />
                    <Text style={styles.settingsHint}>
                      APIキーがある場合は{AI_BATCH_MODEL}とweb searchで調査します。未設定または失敗時はローカル候補で生成します。
                    </Text>
                  </View>

                  <Text style={styles.panelLabel}>タグ設定</Text>
                  {editableTags().map((tag) => (
                    <View key={tag.id} style={styles.tagEditRow}>
                      <View style={[styles.tagSwatch, { backgroundColor: tag.color }]} />
                      <TextInput
                        value={tag.label}
                        onChangeText={(label) => updateTag(tag.id, { label: label || tag.label })}
                        style={styles.tagNameInput}
                      />
                      <View style={styles.tagColorRow}>
                        {tagColorOptions.slice(0, 5).map((color) => (
                          <Pressable
                            key={color}
                            accessibilityLabel={`${tag.label}の色を変更`}
                            onPress={() => updateTag(tag.id, { color })}
                            style={[
                              styles.tagColorButton,
                              { backgroundColor: color },
                              tag.color === color && styles.tagColorButtonActive,
                            ]}
                          />
                        ))}
                      </View>
                    </View>
                  ))}
                  <View style={styles.addTagRow}>
                    <TextInput
                      value={newTagLabel}
                      onChangeText={setNewTagLabel}
                      placeholder="新しいタグ"
                      placeholderTextColor="#8A93A3"
                      style={styles.addTagInput}
                      onSubmitEditing={addTag}
                    />
                    <Pressable style={styles.addTagButton} onPress={addTag}>
                      <Feather name="plus" size={16} color="#FFFFFF" />
                    </Pressable>
                  </View>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </View>
    </View>
  );
}

function ResizeHandle({ onStart }: { onStart: (event: GestureResponderEvent) => void }) {
  return (
    <View
      accessibilityLabel="パネル幅を調整"
      onStartShouldSetResponder={() => true}
      onResponderGrant={onStart}
      style={[styles.resizeHandle, webResizeHandleStyle]}>
      <View style={styles.resizeHandleLine} />
    </View>
  );
}

function ConnectorLayer({
  width,
  height,
  offsetX,
  offsetY,
  edges,
}: {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  edges: {
    from: MindNode & { x: number; y: number };
    to: MindNode & { x: number; y: number };
  }[];
}) {
  const getAnchor = (node: MindNode & { x: number; y: number }, side: 'left' | 'right') => {
    const size = getNodeSize(node);
    if (node.display === 'memo') {
      const lineY = node.y + size.height - memoLineBottomOffset;
      return {
        x: node.x + (side === 'right' ? size.width : 0),
        y: lineY,
      };
    }
    return {
      x: node.x + (side === 'right' ? size.width : 0),
      y: node.y + size.height / 2,
    };
  };

  return (
    <Svg width={width} height={height} style={styles.connectorCanvas} pointerEvents="none">
      {edges.map((edge) => {
        const start = getAnchor(edge.from, 'right');
        const end = getAnchor(edge.to, 'left');
        const startX = offsetX + start.x;
        const startY = offsetY + start.y;
        const endX = offsetX + end.x;
        const endY = offsetY + end.y;
        const distance = Math.max(48, Math.abs(endX - startX) * 0.45);
        const d = [
          `M ${startX} ${startY}`,
          `C ${startX + distance} ${startY}, ${endX - distance} ${endY}, ${endX} ${endY}`,
        ].join(' ');

        return (
          <Path
            key={`${edge.from.id}-${edge.to.id}`}
            d={d}
            stroke="#B8C6D9"
            strokeWidth={2.5}
            fill="none"
            strokeLinecap="round"
          />
        );
      })}
    </Svg>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  danger,
  disabled,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.actionButton, danger && styles.actionButtonDanger, disabled && styles.actionButtonDisabled]}>
      <Feather name={icon} size={16} color={danger ? '#B91C1C' : '#111827'} />
      <Text style={[styles.actionButtonText, danger && styles.actionButtonTextDanger]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: '#F5F7FB',
    flexDirection: 'row',
  },
  appCompact: {
    flexDirection: 'column',
  },
  homeShell: {
    flex: 1,
    backgroundColor: '#F5F7FB',
  },
  homeContent: {
    paddingHorizontal: 28,
    paddingVertical: 28,
    gap: 22,
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
  },
  homeContentCompact: {
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  homeHero: {
    alignItems: 'flex-start',
  },
  homeHeroCopy: {
    width: '100%',
    paddingVertical: 10,
  },
  homeBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  homeBrandTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
  },
  homeBrandSub: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },
  homeTitle: {
    color: '#0F172A',
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 40,
    marginBottom: 10,
  },
  homeDescription: {
    color: '#475569',
    fontSize: 15,
    lineHeight: 23,
    maxWidth: 620,
  },
  homeCommandBar: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  homeCreateGroup: {
    flex: 1.35,
    minWidth: 360,
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#D7E0EC',
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  homeCreateGroupCompact: {
    minWidth: '100%',
  },
  homeCreateInput: {
    flex: 1,
    minHeight: 48,
    color: '#0F172A',
    padding: 0,
    fontSize: 14,
  },
  primaryButtonWide: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
  },
  homeSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  homeSectionTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
  },
  homeSectionMeta: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 4,
  },
  homeSearch: {
    flex: 0.8,
    minWidth: 260,
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D7E0EC',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  homeSearchCompact: {
    minWidth: '100%',
  },
  homeSearchInput: {
    flex: 1,
    color: '#0F172A',
    fontSize: 14,
    padding: 0,
  },
  homeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    alignItems: 'stretch',
  },
  homeProjectCard: {
    width: 348,
    maxWidth: '100%',
    minHeight: 164,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    paddingRight: 46,
    gap: 12,
    position: 'relative',
  },
  homeProjectDeleteButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  homeProjectCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  homeProjectOpenIcon: {
    paddingTop: 3,
    paddingRight: 2,
  },
  homeProjectTitle: {
    flex: 1,
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
  },
  homeProjectSummary: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 20,
  },
  homeProjectMetaRow: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  homeProjectMeta: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '800',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  homeEmptyState: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D7E0EC',
    backgroundColor: '#FFFFFF',
    padding: 24,
    alignItems: 'center',
  },
  homeEmptyTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  homeEmptyText: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 6,
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  confirmDialog: {
    width: '100%',
    maxWidth: 390,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 22,
    alignItems: 'center',
    gap: 12,
  },
  confirmIcon: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  confirmText: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  confirmActions: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  confirmCancelButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  confirmDeleteButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DC2626',
  },
  confirmCancelText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '900',
  },
  confirmDeleteText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  sidebar: {
    width: 292,
    backgroundColor: '#101827',
    padding: 18,
  },
  sidebarCompact: {
    width: '100%',
    maxHeight: 188,
    padding: 12,
  },
  resizeHandle: {
    width: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF3F9',
  },
  resizeHandleLine: {
    width: 4,
    height: 72,
    borderRadius: 999,
    backgroundColor: '#D7E0EC',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  sidebarTopRow: {
    gap: 14,
    marginBottom: 18,
  },
  sidebarHomeButton: {
    alignSelf: 'flex-start',
    minHeight: 34,
    borderRadius: 8,
    backgroundColor: '#182235',
    borderWidth: 1,
    borderColor: '#22314B',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sidebarHomeText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '800',
  },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
  },
  brandSub: {
    color: '#93A4B8',
    fontSize: 12,
    marginTop: 2,
  },
  createBox: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  projectInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: '#182235',
    color: '#F8FAFC',
    paddingHorizontal: 12,
    fontSize: 14,
  },
  iconButtonDark: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectList: {
    flex: 1,
  },
  projectListContent: {
    gap: 8,
    paddingBottom: 20,
  },
  projectListContentCompact: {
    paddingBottom: 8,
  },
  sidebarSearch: {
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: '#182235',
    borderWidth: 1,
    borderColor: '#1E2A3E',
    paddingHorizontal: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sidebarSearchInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 13,
    padding: 0,
  },
  projectItem: {
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#131D2E',
    borderWidth: 1,
    borderColor: '#1E2A3E',
  },
  projectItemActive: {
    backgroundColor: '#F8FAFC',
    borderColor: '#F8FAFC',
  },
  projectTitle: {
    color: '#E5EDF7',
    fontSize: 14,
    fontWeight: '700',
  },
  projectTitleActive: {
    color: '#101827',
  },
  projectSummary: {
    color: '#8FA0B5',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  workspace: {
    flex: 1,
  },
  topbar: {
    minHeight: 92,
    borderBottomWidth: 1,
    borderColor: '#E3E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 22,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  topbarCompact: {
    minHeight: 78,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'flex-start',
  },
  titleEditGroup: {
    flex: 1,
    gap: 8,
  },
  projectTitleInput: {
    color: '#0F172A',
    fontSize: 26,
    fontWeight: '800',
    padding: 0,
  },
  projectTitleInputCompact: {
    fontSize: 20,
  },
  summaryInput: {
    color: '#4B5563',
    fontSize: 14,
    padding: 0,
  },
  topbarStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  topbarStatsCompact: {
    display: 'none',
  },
  statText: {
    color: '#4B5563',
    fontSize: 13,
    fontWeight: '700',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
  },
  bodyCompact: {
    flexDirection: 'column',
  },
  canvasArea: {
    flex: 1,
    backgroundColor: '#EEF3F9',
    position: 'relative',
  },
  canvasAreaCompact: {
    minHeight: 430,
  },
  canvasViewport: {
    flex: 1,
    backgroundColor: '#EEF3F9',
  },
  zoomControls: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D6DDE8',
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  zoomControlsCompact: {
    top: 10,
    right: 10,
    transform: [{ scale: 0.92 }],
    transformOrigin: 'top right',
  },
  zoomButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomFitButton: {
    minWidth: 62,
    height: 36,
    paddingHorizontal: 10,
    borderRightWidth: 1,
    borderColor: '#E5EAF1',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  zoomFitText: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '800',
  },
  zoomValueButton: {
    minWidth: 58,
    height: 36,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#E5EAF1',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  zoomValueText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '900',
  },
  canvasWorld: {
    position: 'relative',
    backgroundColor: '#EEF3F9',
  },
  canvasWorldPanning: {
    opacity: 0.99,
  },
  canvasPanSurface: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
  },
  mindNode: {
    position: 'absolute',
    width: nodeWidth,
    minHeight: nodeHeight,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    padding: 12,
    zIndex: 2,
  },
  memoNode: {
    borderWidth: 0,
    padding: 0,
    overflow: 'visible',
  },
  mindNodeSelected: {
    borderWidth: 2,
  },
  mindNodeDragging: {
    opacity: 0.9,
  },
  nodeBorderDragHandle: {
    position: 'absolute',
    zIndex: 30,
  },
  nodeDragTop: {
    left: 0,
    right: 0,
    top: -9,
    height: 18,
  },
  nodeDragRight: {
    top: 0,
    right: -9,
    bottom: 0,
    width: 18,
  },
  nodeDragBottom: {
    left: 0,
    right: 0,
    bottom: -9,
    height: 18,
  },
  nodeDragLeft: {
    top: 0,
    left: -9,
    bottom: 0,
    width: 18,
  },
  nodeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 7,
  },
  nodeKindGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  nodeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  nodeActionButton: {
    minWidth: 34,
    height: 24,
    borderRadius: 7,
    backgroundColor: '#EEF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 5,
  },
  nodeActionButtonDanger: {
    minWidth: 24,
    backgroundColor: '#FFF1F2',
  },
  nodeHoverDeleteButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
  },
  memoHoverDeleteButton: {
    top: -8,
    right: -8,
  },
  nodeActionText: {
    color: '#2563EB',
    fontSize: 10,
    fontWeight: '900',
  },
  kindDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  nodeKind: {
    fontSize: 11,
    color: '#667085',
    fontWeight: '800',
  },
  authorBadge: {
    minWidth: 34,
    height: 20,
    borderRadius: 999,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authorBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
  },
  nodeText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 19,
  },
  memoText: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    color: '#475569',
  },
  memoInline: {
    width: '100%',
    position: 'relative',
    height: '100%',
    justifyContent: 'flex-end',
    paddingBottom: memoLineWidth + 5,
  },
  memoUnderline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: memoLineWidth,
    borderRadius: 999,
    backgroundColor: '#B8C6D9',
  },
  nodeNote: {
    color: '#667085',
    fontSize: 12,
    marginTop: 6,
  },
  connectorCanvas: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 1,
  },
  inspector: {
    width: 360,
    backgroundColor: '#FFFFFF',
    borderLeftWidth: 1,
    borderColor: '#E3E8F0',
  },
  inspectorCompact: {
    width: '100%',
    maxHeight: 430,
    borderLeftWidth: 0,
    borderTopWidth: 1,
  },
  inspectorContent: {
    padding: 18,
    gap: 14,
  },
  pathBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  pathText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
    maxWidth: 260,
  },
  panelLabel: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '900',
  },
  inspectorModeRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 4,
    borderRadius: 8,
    backgroundColor: '#EEF3F9',
  },
  inspectorModeButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  inspectorModeButtonActive: {
    backgroundColor: '#111827',
  },
  inspectorModeText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '900',
  },
  inspectorModeTextActive: {
    color: '#FFFFFF',
  },
  nodeInput: {
    minHeight: 86,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    padding: 12,
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  kindRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  kindButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  kindButtonText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '800',
  },
  kindButtonTextActive: {
    color: '#FFFFFF',
  },
  displayRow: {
    flexDirection: 'row',
    gap: 8,
  },
  displayButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  displayButtonActive: {
    borderColor: '#111827',
    backgroundColor: '#111827',
  },
  displayButtonText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '800',
  },
  displayButtonTextActive: {
    color: '#FFFFFF',
  },
  noteInput: {
    minHeight: 160,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    padding: 12,
    color: '#334155',
    fontSize: 14,
    lineHeight: 20,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    width: '48%',
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
  },
  actionButtonDanger: {
    borderColor: '#FECACA',
    backgroundColor: '#FFF5F5',
  },
  actionButtonDisabled: {
    opacity: 0.35,
  },
  actionButtonText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '800',
  },
  actionButtonTextDanger: {
    color: '#B91C1C',
  },
  aiBatchStatus: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
  },
  aiBatchStatusError: {
    color: '#B91C1C',
  },
  codexPanel: {
    gap: 12,
  },
  codexHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  codexSubText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 5,
  },
  codexNewButton: {
    minHeight: 34,
    borderRadius: 8,
    backgroundColor: '#111827',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  codexNewButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  codexConversationList: {
    gap: 8,
    paddingVertical: 2,
  },
  codexConversationChip: {
    maxWidth: 178,
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    backgroundColor: '#FFFFFF',
    paddingLeft: 12,
    paddingRight: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  codexConversationChipActive: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  codexConversationText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '800',
    maxWidth: 126,
  },
  codexConversationTextActive: {
    color: '#FFFFFF',
  },
  codexConversationDelete: {
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codexMessages: {
    gap: 10,
  },
  codexMessage: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    gap: 7,
  },
  codexUserMessage: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  codexAssistantMessage: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  codexMessageRole: {
    color: '#2563EB',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  codexMessageText: {
    color: '#0F172A',
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
  },
  codexSuggestionList: {
    gap: 8,
    marginTop: 2,
  },
  codexSuggestionCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#FFFFFF',
    padding: 10,
    gap: 6,
  },
  codexSuggestionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  codexSuggestionTitle: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '900',
    flex: 1,
  },
  codexSuggestionText: {
    color: '#475569',
    fontSize: 12,
    lineHeight: 17,
  },
  codexSuggestionAction: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '900',
  },
  codexEmptyState: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    backgroundColor: '#F8FAFC',
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  codexEmptyTitle: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '900',
  },
  codexEmptyText: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  codexStatusText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '800',
  },
  codexComposer: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-end',
  },
  codexComposerInput: {
    flex: 1,
    minHeight: 76,
    maxHeight: 138,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    padding: 11,
    color: '#0F172A',
    fontSize: 13,
    lineHeight: 19,
  },
  codexSendButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagEditor: {
    gap: 10,
    borderTopWidth: 1,
    borderColor: '#E5EAF1',
    paddingTop: 14,
  },
  settingsSection: {
    gap: 8,
    paddingBottom: 14,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderColor: '#E5EAF1',
  },
  apiKeyInput: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    paddingHorizontal: 12,
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
  },
  settingsHint: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 18,
  },
  tagEditRow: {
    gap: 8,
    position: 'relative',
  },
  tagSwatch: {
    width: 16,
    height: 16,
    borderRadius: 999,
    position: 'absolute',
    left: 10,
    top: 12,
    zIndex: 1,
  },
  tagNameInput: {
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    paddingLeft: 34,
    paddingRight: 10,
    color: '#111827',
    fontSize: 13,
    fontWeight: '800',
  },
  tagColorRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tagColorButton: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  tagColorButtonActive: {
    borderColor: '#111827',
  },
  addTagRow: {
    flexDirection: 'row',
    gap: 8,
  },
  addTagInput: {
    flex: 1,
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    paddingHorizontal: 12,
    color: '#111827',
  },
  addTagButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickAdd: {
    gap: 8,
  },
  quickAddInput: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    paddingHorizontal: 12,
    color: '#111827',
  },
  primaryButton: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F7FB',
    padding: 24,
    gap: 12,
  },
  emptyTitle: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '900',
  },
  input: {
    width: '100%',
    maxWidth: 420,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
  },
});
