import { Feather } from '@expo/vector-icons';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
const inspectorMaxWidth = 520;
const tagColorOptions = ['#0F766E', '#2563EB', '#7C3AED', '#DC2626', '#D97706', '#0891B2', '#475569'];
const memoLineBottomOffset = 3;
const memoLineWidth = 2.5;
const canvasDragPanSensitivity = 1.85;

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

export default function MindmapHome() {
  const initialPanels = loadPanelSizes();
  const [projects, setProjects] = useState<MindProject[]>(loadProjects);
  const [activeProjectId, setActiveProjectId] = useState('');
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [projectQuery, setProjectQuery] = useState('');
  const [newTagLabel, setNewTagLabel] = useState('');
  const [quickChildText, setQuickChildText] = useState('');
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [panningCanvas, setPanningCanvas] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [inspectorMode, setInspectorMode] = useState<'edit' | 'settings'>('edit');
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
        Math.min(inspectorMaxWidth, width * 0.46)
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

  function isCanvasBackgroundEvent(event: GestureResponderEvent) {
    const nativeTarget = event.nativeEvent.target as unknown;
    const currentTarget = event.currentTarget as unknown;
    return nativeTarget === currentTarget;
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
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        node.scrollLeft += event.deltaX;
        node.scrollTop += event.deltaY;
        return;
      }

      event.preventDefault();
      const rect = node.getBoundingClientRect();
      scheduleWheelZoom(Math.exp(-event.deltaY * 0.0017), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };

    const blockGesture = (event: Event) => {
      event.preventDefault();
    };

    node.addEventListener('wheel', handleWheel, { passive: false });
    node.addEventListener('gesturestart', blockGesture, { passive: false } as AddEventListenerOptions);
    node.addEventListener('gesturechange', blockGesture, { passive: false } as AddEventListenerOptions);
    node.addEventListener('gestureend', blockGesture, { passive: false } as AddEventListenerOptions);

    return () => {
      node.removeEventListener('wheel', handleWheel);
      node.removeEventListener('gesturestart', blockGesture as EventListener);
      node.removeEventListener('gesturechange', blockGesture as EventListener);
      node.removeEventListener('gestureend', blockGesture as EventListener);
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
                style={styles.homeSearchInput}
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
                    <View style={styles.homeProjectCardHeader}>
                      <Text style={styles.homeProjectTitle} numberOfLines={2}>
                        {project.title}
                      </Text>
                      <Feather name="arrow-up-right" size={16} color="#2563EB" />
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
      </View>
    );
  }

  function renderCanvasSurface() {
    if (!layout) return null;

    const canvasChildren = (
      <View
        onStartShouldSetResponder={isCanvasBackgroundEvent}
        onMoveShouldSetResponder={isCanvasBackgroundEvent}
        onResponderGrant={beginCanvasPan}
        onResponderMove={updateCanvasPan}
        onResponderRelease={endCanvasPan}
        onResponderTerminate={endCanvasPan}
        style={[
          styles.canvasWorld,
          panningCanvas && styles.canvasWorldPanning,
          Platform.OS === 'web' && (panningCanvas ? webGrabbingCursorStyle : webGrabCursorStyle),
          {
            width: contentWidth,
            height: contentHeight,
            transformOrigin: 'top left',
            transform: [{ scale: zoom }],
          } as object,
        ]}>
        <ConnectorLayer
          width={contentWidth}
          height={contentHeight}
          offsetX={canvasPaddingX}
          offsetY={canvasPaddingY}
          edges={layout.edges}
        />
        <View
          style={[
            styles.canvas,
            {
              left: canvasPaddingX,
              top: canvasPaddingY,
              width: layout.width,
              height: layout.height,
            },
          ]}>
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
                    left: node.x,
                    top: node.y,
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
            style={styles.sidebarSearchInput}
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
                    <ActionButton icon="zap" label="AIで伸ばす" onPress={() => addAiBranch(selectedNode.id)} />
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
              ) : (
                <View style={styles.tagEditor}>
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
    gap: 12,
  },
  homeProjectCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
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
  canvas: {
    position: 'absolute',
    backgroundColor: 'transparent',
    zIndex: 1,
  },
  canvasWorld: {
    position: 'relative',
    backgroundColor: '#EEF3F9',
  },
  canvasWorldPanning: {
    opacity: 0.99,
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
  memoNode: {
    borderWidth: 0,
    padding: 0,
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
    minHeight: '100%',
    position: 'relative',
    justifyContent: 'flex-start',
    paddingBottom: memoLineBottomOffset + memoLineWidth + 5,
  },
  memoUnderline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: memoLineBottomOffset - memoLineWidth / 2,
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
    zIndex: 0,
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
  tagEditor: {
    gap: 10,
    borderTopWidth: 1,
    borderColor: '#E5EAF1',
    paddingTop: 14,
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
