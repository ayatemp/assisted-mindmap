import { Feather } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
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
  MindProject,
  NodeKind,
  bumpProject,
  createAssistantHint,
  createNode,
  createProject,
  createSeedProjects,
  findParentId,
  getDescendantIds,
  getPath,
  layoutMindmap,
  touchNode,
} from '@/lib/mindmap';

const STORAGE_KEY = 'assisted-mindmap-projects-v1';
const nodeWidth = 228;
const nodeHeight = 82;

function loadProjects() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return createSeedProjects();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MindProject[]) : createSeedProjects();
  } catch {
    return createSeedProjects();
  }
}

function saveProjects(projects: MindProject[]) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

function kindLabel(kind: NodeKind) {
  return {
    theme: 'テーマ',
    idea: 'アイデア',
    question: '問い',
    evidence: '検証',
    risk: 'リスク',
  }[kind];
}

function kindColor(kind: NodeKind) {
  return {
    theme: '#111827',
    idea: '#0F766E',
    question: '#2563EB',
    evidence: '#7C3AED',
    risk: '#DC2626',
  }[kind];
}

export default function MindmapHome() {
  const [projects, setProjects] = useState<MindProject[]>(loadProjects);
  const [activeProjectId, setActiveProjectId] = useState(projects[0]?.id ?? '');
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];
  const [selectedNodeId, setSelectedNodeId] = useState(activeProject?.rootId ?? '');
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [quickChildText, setQuickChildText] = useState('');
  const { width } = useWindowDimensions();
  const compact = width < 920;

  const selectedProject = activeProject;
  const selectedNode = selectedProject?.nodes[selectedNodeId] ?? selectedProject?.nodes[selectedProject.rootId];
  const layout = useMemo(
    () => (selectedProject ? layoutMindmap(selectedProject) : null),
    [selectedProject]
  );
  const selectedPath = selectedProject && selectedNode ? getPath(selectedProject, selectedNode.id) : [];
  const assistantHint =
    selectedProject && selectedNode ? createAssistantHint(selectedProject, selectedNode.id) : '';

  function commitProjects(nextProjects: MindProject[]) {
    setProjects(nextProjects);
    saveProjects(nextProjects);
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

  function addProject() {
    const project = createProject(newProjectTitle || '新しい思考プロジェクト');
    const next = [project, ...projects];
    setNewProjectTitle('');
    commitProjects(next);
    setActiveProjectId(project.id);
    setSelectedNodeId(project.rootId);
  }

  function updateSelectedNode(partial: Partial<MindNode>) {
    if (!selectedNode) return;
    updateProject((project) =>
      bumpProject({
        ...project,
        nodes: {
          ...project.nodes,
          [selectedNode.id]: touchNode({ ...selectedNode, ...partial }),
        },
      })
    );
  }

  function addChildToNode(parentId: string, text?: string, kind: NodeKind = 'idea') {
    const parentNode = selectedProject?.nodes[parentId];
    if (!parentNode) return;
    const child = createNode(text || quickChildText || '新しい枝', kind);
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

  function addChild(text?: string, kind: NodeKind = 'idea') {
    if (!selectedNode) return;
    addChildToNode(selectedNode.id, text, kind);
  }

  function addAiBranch(nodeId: string) {
    if (!selectedProject) return;
    const hint = createAssistantHint(selectedProject, nodeId).replace(/^いま選んでいる「.*?」について、/, '');
    addChildToNode(nodeId, hint, 'question');
  }

  function addSibling() {
    if (!selectedProject || !selectedNode || selectedNode.id === selectedProject.rootId) return;
    const parentId = findParentId(selectedProject, selectedNode.id);
    if (!parentId) return;
    const sibling = createNode('同じ階層の新しい枝', 'idea');
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
            children: parent.children.filter((id) => id !== selectedNode.id),
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

  function cycleHint() {
    if (!selectedNode) return;
    updateSelectedNode({ hintCursor: selectedNode.hintCursor + 1 });
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

  if (!selectedProject || !layout || !selectedNode) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>プロジェクトを作成してください</Text>
        <TextInput
          value={newProjectTitle}
          onChangeText={setNewProjectTitle}
          placeholder="例: pseudoGTの新しい研究案"
          style={styles.input}
        />
        <Pressable style={styles.primaryButton} onPress={addProject}>
          <Text style={styles.primaryButtonText}>作成</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.app, compact && styles.appCompact]}>
      <View style={[styles.sidebar, compact && styles.sidebarCompact]}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}>
            <Feather name="git-branch" size={18} color="#F8FAFC" />
          </View>
          <View>
            <Text style={styles.brandTitle}>Assisted Mindmap</Text>
            <Text style={styles.brandSub}>local thinking workspace</Text>
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

        <ScrollView style={styles.projectList} contentContainerStyle={styles.projectListContent}>
          {projects.map((project) => {
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

      <View style={styles.workspace}>
        <View style={styles.topbar}>
          <View style={styles.titleEditGroup}>
            <TextInput
              value={selectedProject.title}
              onChangeText={renameProjectTitle}
              style={styles.projectTitleInput}
            />
            <TextInput
              value={selectedProject.summary}
              onChangeText={(summary) => updateProject((project) => bumpProject({ ...project, summary }))}
              placeholder="このプロジェクトの目的・メモ"
              placeholderTextColor="#8A93A3"
              style={styles.summaryInput}
            />
          </View>
          <View style={styles.topbarStats}>
            <Feather name="layers" size={16} color="#4B5563" />
            <Text style={styles.statText}>{Object.keys(selectedProject.nodes).length} nodes</Text>
          </View>
        </View>

        <View style={[styles.body, compact && styles.bodyCompact]}>
          <ScrollView
            style={styles.canvasViewport}
            contentContainerStyle={{ width: layout.width, height: layout.height }}
            horizontal
            nestedScrollEnabled>
            <ScrollView contentContainerStyle={{ width: layout.width, height: layout.height }}>
              <View style={[styles.canvas, { width: layout.width, height: layout.height }]}>
                {layout.edges.map((edge) => (
                  <Connector key={`${edge.from.id}-${edge.to.id}`} from={edge.from} to={edge.to} />
                ))}
                {layout.nodes.map((node) => (
                  <Pressable
                    key={node.id}
                    onPress={() => setSelectedNodeId(node.id)}
                    style={[
                      styles.mindNode,
                      {
                        left: node.x,
                        top: node.y,
                        borderColor: node.id === selectedNode.id ? kindColor(node.kind) : '#D6DDE8',
                      },
                      node.id === selectedNode.id && styles.mindNodeSelected,
                    ]}>
                    <View style={styles.nodeHeader}>
                      <View style={styles.nodeKindGroup}>
                        <View style={[styles.kindDot, { backgroundColor: kindColor(node.kind) }]} />
                        <Text style={styles.nodeKind}>{kindLabel(node.kind)}</Text>
                      </View>
                      <View style={styles.nodeActions}>
                        <Pressable
                          accessibilityLabel="AIで伸ばす"
                          onPress={(event: GestureResponderEvent) => {
                            event.stopPropagation();
                            addAiBranch(node.id);
                          }}
                          style={styles.nodeActionButton}>
                          <Feather name="zap" size={13} color="#2563EB" />
                          <Text style={styles.nodeActionText}>AI</Text>
                        </Pressable>
                        {node.id !== selectedProject.rootId ? (
                          <Pressable
                            accessibilityLabel="ノードを削除"
                            onPress={(event: GestureResponderEvent) => {
                              event.stopPropagation();
                              deleteNode(node.id);
                            }}
                            style={[styles.nodeActionButton, styles.nodeActionButtonDanger]}>
                            <Feather name="trash-2" size={13} color="#B91C1C" />
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                    <Text style={styles.nodeText} numberOfLines={2}>
                      {node.text}
                    </Text>
                    {node.note ? (
                      <Text style={styles.nodeNote} numberOfLines={1}>
                        {node.note}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </ScrollView>

          <View style={[styles.inspector, compact && styles.inspectorCompact]}>
            <ScrollView contentContainerStyle={styles.inspectorContent}>
              <View style={styles.pathBar}>
                {selectedPath.map((node, index) => (
                  <Text key={node.id} style={styles.pathText} numberOfLines={1}>
                    {index > 0 ? ' / ' : ''}
                    {node.text}
                  </Text>
                ))}
              </View>

              <Text style={styles.panelLabel}>選択中の枝</Text>
              <TextInput
                value={selectedNode.text}
                onChangeText={(text) => updateSelectedNode({ text })}
                multiline
                style={styles.nodeInput}
              />

              <View style={styles.kindRow}>
                {(['idea', 'question', 'evidence', 'risk'] as NodeKind[]).map((kind) => (
                  <Pressable
                    key={kind}
                    onPress={() => updateSelectedNode({ kind })}
                    style={[
                      styles.kindButton,
                      selectedNode.kind === kind && { backgroundColor: kindColor(kind), borderColor: kindColor(kind) },
                    ]}>
                    <Text style={[styles.kindButtonText, selectedNode.kind === kind && styles.kindButtonTextActive]}>
                      {kindLabel(kind)}
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
                <ActionButton icon="plus-square" label="同階層" onPress={addSibling} disabled={selectedNode.id === selectedProject.rootId} />
                <ActionButton icon="refresh-cw" label="問い更新" onPress={cycleHint} />
                <ActionButton icon="trash-2" label="削除" onPress={deleteSelectedNode} danger disabled={selectedNode.id === selectedProject.rootId} />
              </View>

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

              <View style={styles.assistantPanel}>
                <View style={styles.assistantHeader}>
                  <View style={styles.assistantMark}>
                    <Feather name="zap" size={16} color="#F8FAFC" />
                  </View>
                  <View>
                    <Text style={styles.assistantTitle}>Codex comment</Text>
                    <Text style={styles.assistantSub}>この枝を広げるための一言</Text>
                  </View>
                </View>
                <Text style={styles.assistantText}>{assistantHint}</Text>
                <Pressable
                  style={styles.assistantButton}
                  onPress={() => addAiBranch(selectedNode.id)}>
                  <Feather name="message-square" size={16} color="#0F172A" />
                  <Text style={styles.assistantButtonText}>AIで伸ばす</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </View>
    </View>
  );
}

function Connector({ from, to }: { from: MindNode & { x: number; y: number }; to: MindNode & { x: number; y: number } }) {
  const startX = from.x + nodeWidth;
  const startY = from.y + nodeHeight / 2;
  const endX = to.x;
  const endY = to.y + nodeHeight / 2;
  const midX = startX + (endX - startX) / 2;

  return (
    <>
      <View style={[styles.line, { left: startX, top: startY, width: midX - startX }]} />
      <View style={[styles.line, { left: midX, top: endY, width: endX - midX }]} />
      <View
        style={[
          styles.verticalLine,
          {
            left: midX,
            top: Math.min(startY, endY),
            height: Math.abs(endY - startY),
          },
        ]}
      />
    </>
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
  sidebar: {
    width: 292,
    backgroundColor: '#101827',
    padding: 18,
  },
  sidebarCompact: {
    width: '100%',
    maxHeight: 210,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
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
  canvasViewport: {
    flex: 1,
    backgroundColor: '#EEF3F9',
  },
  canvas: {
    position: 'relative',
    backgroundColor: '#EEF3F9',
  },
  mindNode: {
    position: 'absolute',
    width: nodeWidth,
    minHeight: nodeHeight,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    padding: 12,
  },
  mindNodeSelected: {
    borderWidth: 2,
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
  nodeText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 19,
  },
  nodeNote: {
    color: '#667085',
    fontSize: 12,
    marginTop: 6,
  },
  line: {
    position: 'absolute',
    height: 2,
    backgroundColor: '#B9C4D3',
  },
  verticalLine: {
    position: 'absolute',
    width: 2,
    backgroundColor: '#B9C4D3',
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
  noteInput: {
    minHeight: 76,
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
  assistantPanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BCD7FF',
    backgroundColor: '#EFF6FF',
    padding: 14,
    gap: 12,
  },
  assistantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  assistantMark: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  assistantTitle: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '900',
  },
  assistantSub: {
    color: '#52647A',
    fontSize: 12,
    marginTop: 2,
  },
  assistantText: {
    color: '#0F172A',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  assistantButton: {
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C9DAF7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  assistantButtonText: {
    color: '#0F172A',
    fontSize: 13,
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
