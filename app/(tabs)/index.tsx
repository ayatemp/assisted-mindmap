import { Feather } from '@expo/vector-icons';
import { useMemo, useRef, useState } from 'react';
import Svg, { Path } from 'react-native-svg';
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
  createAssistantSeed,
  createNode,
  createProject,
  createSeedProjects,
  findParentId,
  getDescendantIds,
  getPath,
  layoutMindmap,
  sanitizeProject,
  touchNode,
} from '@/lib/mindmap';

const STORAGE_KEY = 'assisted-mindmap-projects-v1';
const nodeWidth = 228;
const nodeHeight = 82;
const childOffsetX = 286;
const childOffsetY = 112;
const minZoom = 0.45;
const maxZoom = 2.2;
const fitPadding = 120;
const webCanvasViewportStyle =
  Platform.OS === 'web'
    ? ({
        overflow: 'scroll',
        overscrollBehavior: 'contain',
        scrollbarWidth: 'thin',
      } as object)
    : {};

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
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const canvasScrollerRef = useRef<any>(null);
  const dragRef = useRef<{
    nodeId: string;
    startPageX: number;
    startPageY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const { width } = useWindowDimensions();
  const compact = width < 920;

  const selectedProject = activeProject;
  const selectedNode = selectedProject?.nodes[selectedNodeId] ?? selectedProject?.nodes[selectedProject.rootId];
  const layout = useMemo(
    () => (selectedProject ? layoutMindmap(selectedProject) : null),
    [selectedProject]
  );
  const selectedPath = selectedProject && selectedNode ? getPath(selectedProject, selectedNode.id) : [];
  const scaledWidth = layout ? layout.width * zoom : 0;
  const scaledHeight = layout ? layout.height * zoom : 0;

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

  function addChildToNode(parentId: string, text?: string, kind: NodeKind = 'idea', note = '') {
    const parentNode = selectedProject?.nodes[parentId];
    if (!parentNode) return;
    const child = createNode(text || quickChildText || '新しい枝', kind);
    const parentPosition = findPosition(parentId);
    const siblingCount = parentNode.children.length;
    child.note = note;
    child.position = {
      x: parentPosition.x + childOffsetX,
      y: parentPosition.y + (siblingCount - Math.max(parentNode.children.length - 1, 0) / 2) * childOffsetY,
    };
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
    const parentNode = selectedProject.nodes[nodeId];
    if (!parentNode) return;
    const seed = createAssistantSeed(selectedProject, nodeId);
    const child = createNode(seed.text, seed.kind);
    const parentPosition = findPosition(nodeId);
    child.note = seed.note;
    child.position = {
      x: parentPosition.x + childOffsetX,
      y: parentPosition.y + (parentNode.children.length + 0.2) * childOffsetY,
    };
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
              x: Math.max(0, Math.round(x)),
              y: Math.max(0, Math.round(y)),
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
    const previousZoom = zoom;

    setZoom(clamped);

    if (!metrics || previousZoom === clamped || typeof window === 'undefined') {
      return;
    }

    const focusX = focus?.x ?? metrics.clientWidth / 2;
    const focusY = focus?.y ?? metrics.clientHeight / 2;
    const contentX = (metrics.scrollLeft + focusX) / previousZoom;
    const contentY = (metrics.scrollTop + focusY) / previousZoom;

    window.requestAnimationFrame(() => {
      const node = canvasScrollerRef.current;
      if (!node) return;
      node.scrollLeft = contentX * clamped - focusX;
      node.scrollTop = contentY * clamped - focusY;
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
        (metrics.clientWidth - fitPadding) / layout.width,
        (metrics.clientHeight - fitPadding) / layout.height
      )
    );
    setZoom(nextZoom);

    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      const node = canvasScrollerRef.current;
      if (!node) return;
      node.scrollLeft = Math.max(0, (layout.width * nextZoom - metrics.clientWidth) / 2);
      node.scrollTop = Math.max(0, (layout.height * nextZoom - metrics.clientHeight) / 2);
    });
  }

  const wheelZoomProps =
    Platform.OS === 'web'
      ? ({
          onWheel: (event: {
            ctrlKey?: boolean;
            metaKey?: boolean;
            deltaY: number;
            clientX: number;
            clientY: number;
            currentTarget?: { getBoundingClientRect?: () => DOMRect };
            preventDefault?: () => void;
          }) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault?.();
            const rect = event.currentTarget?.getBoundingClientRect?.();
            applyZoom(zoom + (event.deltaY > 0 ? -0.08 : 0.08), {
              x: rect ? event.clientX - rect.left : 0,
              y: rect ? event.clientY - rect.top : 0,
            });
          },
        } as const)
      : {};

  function renderCanvasSurface() {
    if (!layout) return null;

    const canvasChildren = (
      <View
        style={[
          styles.canvas,
          {
            width: layout.width,
            height: layout.height,
            transformOrigin: 'top left',
            transform: [{ scale: zoom }],
          } as object,
        ]}>
        <ConnectorLayer width={layout.width} height={layout.height} edges={layout.edges} />
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
              draggingNodeId === node.id && styles.mindNodeDragging,
            ]}>
            <View style={styles.nodeHeader}>
              <View style={styles.nodeKindGroup}>
                <View style={[styles.kindDot, { backgroundColor: kindColor(node.kind) }]} />
                <Text style={styles.nodeKind}>{kindLabel(node.kind)}</Text>
              </View>
              <View style={styles.nodeActions}>
                <View
                  accessibilityLabel="ノードを移動"
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={(event) => beginDrag(event, node.id)}
                  onResponderMove={updateDrag}
                  onResponderRelease={endDrag}
                  onResponderTerminate={endDrag}
                  style={styles.nodeActionButton}>
                  <Feather name="move" size={13} color="#334155" />
                </View>
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
    );

    if (Platform.OS === 'web') {
      return (
        <View
          ref={canvasScrollerRef}
          style={[styles.canvasViewport, webCanvasViewportStyle]}
          {...wheelZoomProps}>
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
          <View style={styles.canvasArea}>
            <View style={styles.zoomControls}>
              <Pressable
                accessibilityLabel="全体表示"
                onPress={fitToCanvas}
                style={styles.zoomFitButton}>
                <Feather name="maximize-2" size={14} color="#0F172A" />
                <Text style={styles.zoomFitText}>Fit</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="ズームアウト"
                onPress={() => applyZoom(zoom - 0.1)}
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
                onPress={() => applyZoom(zoom + 0.1)}
                style={styles.zoomButton}>
                <Feather name="plus" size={16} color="#111827" />
              </Pressable>
            </View>
            {renderCanvasSurface()}
          </View>

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
                <ActionButton icon="zap" label="AIで伸ばす" onPress={() => addAiBranch(selectedNode.id)} />
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
            </ScrollView>
          </View>
        </View>
      </View>
    </View>
  );
}

function ConnectorLayer({
  width,
  height,
  edges,
}: {
  width: number;
  height: number;
  edges: {
    from: MindNode & { x: number; y: number };
    to: MindNode & { x: number; y: number };
  }[];
}) {
  return (
    <Svg width={width} height={height} style={styles.connectorCanvas} pointerEvents="none">
      {edges.map((edge) => {
        const startX = edge.from.x + nodeWidth;
        const startY = edge.from.y + nodeHeight / 2;
        const endX = edge.to.x;
        const endY = edge.to.y + nodeHeight / 2;
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
  canvasArea: {
    flex: 1,
    backgroundColor: '#EEF3F9',
    position: 'relative',
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
  mindNodeDragging: {
    opacity: 0.9,
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
  connectorCanvas: {
    position: 'absolute',
    left: 0,
    top: 0,
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
