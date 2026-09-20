import React, { useState, useEffect, useRef } from 'react';
import {
  Layout,
  Typography,
  Badge,
  Form,
  Input,
  Button,
  Segmented,
  Checkbox,
  Card,
  Space,
  ConfigProvider,
  theme,
  Empty,
  message,
  Slider,
  Select,
  Switch,
  Upload,
  Alert,
  Timeline
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  FileSearchOutlined,
  SettingOutlined,
  HistoryOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  InboxOutlined,
  RobotOutlined
} from '@ant-design/icons';
import DiffCanvas from './DiffCanvas';
import SideBySideDiff from './SideBySideDiff';
import { AuditSidebar } from './AuditSidebar';
import ChatbotDrawer from './ChatbotDrawer';
import WorkspaceShell from './WorkspaceShell';
import CircuitBuilderCanvas from './CircuitBuilderCanvas';
import ComponentSourcingHub from './ComponentSourcingHub';
import { API_BASE_URL } from './config.js';

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

export default function App() {
  const [form] = Form.useForm();
  const repoLoadTimeoutRef = useRef(null);
  // Ref to the SideBySideDiff component — used to call focusElement() imperatively
  const sideBySideRef = useRef(null);
  // Ref to the DiffCanvas component — used for Overlay Slider and Color Delta Map pan/zoom
  const diffCanvasRef = useRef(null);
  
  // State for connection status
  const [backendStatus, setBackendStatus] = useState('checking'); // checking | healthy | unhealthy
  const [kicadVersion, setKicadVersion] = useState('');

  // Form states (controlled inputs)
  const [repoPath, setRepoPath] = useState(
    localStorage.getItem('banana:lastRepoPath') || ''
  );

  useEffect(() => {
    if (repoPath) localStorage.setItem('banana:lastRepoPath', repoPath);
  }, [repoPath]);

  const [baseCommit, setBaseCommit] = useState('ab691fc');
  const [targetCommit, setTargetCommit] = useState('ab691fc');
  const [relativeFilePath, setRelativeFilePath] = useState('debug/examples/starfish.kicad_pcb');
  
  // Controls states
  const [diffMode, setDiffMode] = useState('Overlay Slider');
  const [selectedLayers, setSelectedLayers] = useState(['F.Cu', 'F.SilkS', 'F.Courtyard', 'Edge.Cuts']);
  const [layerFilter, setLayerFilter] = useState('');
  const [sliderValue, setSliderValue] = useState(50);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  
  // Git repository info detection
  const [repoInfo, setRepoInfo] = useState(null);
  const [soloLayer, setSoloLayer] = useState(null);
  const [compareBranches, setCompareBranches] = useState(false);
  const [changedFiles, setChangedFiles] = useState([]);
  
  // Diff result state
  const [loading, setLoading] = useState(false);
  const [diffData, setDiffData] = useState(null);
  // Per-layer opacity: { 'F.Cu': 1, 'B.Cu': 1, ... } — 0 to 1
  const [layerOpacities, setLayerOpacities] = useState({});
  const [activeAuditIdx, setActiveAuditIdx] = useState(null);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [activeStudio, setActiveStudio] = useState('diff'); // 'diff' | 'builder' | 'sourcing'
  const [circuits, setCircuits] = useState([]);
  const [activeCircuitId, setActiveCircuitId] = useState(null);
  const [copilotMode, setCopilotMode] = useState('chat');

  const fetchWorkspace = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/workspace`);
      if (res.ok) {
        const data = await res.json();
        if (data.circuits && data.circuits.length > 0) {
          setCircuits(data.circuits);
          setActiveCircuitId(prev => prev || data.circuits[0].id);
        }
      }
    } catch (err) {
      console.warn('Could not fetch workspace data:', err);
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, []);

  const activeCircuit = circuits.find(c => c.id === activeCircuitId) || circuits[0] || null;

  // Check health and load repo info on mount
  useEffect(() => {
    checkHealth();
    loadRepoInfo(repoPath, true);
  }, []);

  // Fetch file-specific commit history when repoPath or relativeFilePath changes
  useEffect(() => {
    const fetchFileCommits = async () => {
      if (!repoPath || !relativeFilePath) return;

      try {
        const response = await fetch(`${API_BASE_URL}/api/git/commits?repoPath=${encodeURIComponent(repoPath)}&filePath=${encodeURIComponent(relativeFilePath)}`);
        if (response.ok) {
          const data = await response.json();
          setRepoInfo(prev => {
            if (!prev) return null;
            return {
              ...prev,
              commits: data.commits
            };
          });

          // Gracefully select commits to prevent index errors
          if (data.commits && data.commits.length > 0) {
            setBaseCommit(currentBase => {
              const hasBase = data.commits.some(c => c.hash === currentBase);
              if (hasBase) return currentBase;
              const nextBase = data.commits[Math.min(1, data.commits.length - 1)].hash;
              form.setFieldValue('baseCommit', nextBase);
              return nextBase;
            });

            setTargetCommit(currentTarget => {
              const hasTarget = data.commits.some(c => c.hash === currentTarget);
              if (hasTarget) return currentTarget;
              const nextTarget = data.commits[0].hash;
              form.setFieldValue('targetCommit', nextTarget);
              return nextTarget;
            });
          } else {
            setBaseCommit('');
            setTargetCommit('');
            form.setFieldValue('baseCommit', '');
            form.setFieldValue('targetCommit', '');
          }
        }
      } catch (err) {
        console.error("Failed to fetch file-specific commits:", err);
      }
    };

    fetchFileCommits();
  }, [repoPath, relativeFilePath, form]);

  const loadRepoInfo = async (path, silent = false) => {
    if (!path) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/git/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ repoPath: path }),
      });

      if (response.ok) {
        const data = await response.json();
        setRepoInfo(data);
        form.setFieldsValue({
          repoPath: data.resolvedPath,
        });
        setRepoPath(data.resolvedPath);
        
        // Auto-select first kicad file if file not set or not in the list
        if (data.kicadFiles && data.kicadFiles.length > 0) {
          if (!data.kicadFiles.includes(relativeFilePath)) {
            setRelativeFilePath(data.kicadFiles[0]);
            form.setFieldsValue({ relativeFilePath: data.kicadFiles[0] });
          }
        }
        if (!silent) {
          message.success(`Repository detected: ${data.resolvedPath}`);
        }
      } else {
        const err = await response.json();
        message.error(err.error || 'Failed to detect git repo details');
      }
    } catch (err) {
      message.error(`Connection error: ${err.message}`);
    }
  };

  const fetchChangedFiles = async (path, base, target) => {
    if (!path || !base || !target) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/git/diff-files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ repoPath: path, baseRef: base, targetRef: target }),
      });
      if (response.ok) {
        const data = await response.json();
        setChangedFiles(data.files || []);
        if (data.files.length > 0) {
          setRelativeFilePath(data.files[0]);
          form.setFieldValue('relativeFilePath', data.files[0]);
          message.info(`Found ${data.files.length} changed design file(s) between selected refs.`);
        } else {
          setRelativeFilePath('');
          form.setFieldValue('relativeFilePath', '');
          message.warning("No changed KiCad design files found between these refs.");
        }
      }
    } catch (err) {
      console.error("Failed to fetch changed files:", err);
    }
  };

  const handleFileDraggedOrDropped = (file) => {
    const nativeFile = file.originFileObj || file;
    const path = nativeFile.webkitRelativePath || '';
    
    if (path) {
      const parts = path.split('/');
      const repoName = parts[0];
      const relativePath = parts.slice(1).join('/');
      
      if (relativePath.endsWith('.kicad_pcb') || relativePath.endsWith('.kicad_sch')) {
        setRelativeFilePath(relativePath);
        form.setFieldValue('relativeFilePath', relativePath);
      }
      
      if (repoLoadTimeoutRef.current) {
        clearTimeout(repoLoadTimeoutRef.current);
      }
      repoLoadTimeoutRef.current = setTimeout(() => {
        loadRepoInfo(repoName, false);
      }, 300);
    } else {
      const name = nativeFile.name;
      if (name.endsWith('.kicad_pcb') || name.endsWith('.kicad_sch')) {
        setRelativeFilePath(name);
        form.setFieldValue('relativeFilePath', name);
      }
      message.info("Single file dropped. Please verify or input the local absolute repository path below.");
    }
  };

  const handleFolderDrop = async (e) => {
    e.preventDefault();
    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const entry = items[0].webkitGetAsEntry ? items[0].webkitGetAsEntry() : null;
      if (entry && entry.isDirectory) {
        loadRepoInfo(entry.name, false);
      } else if (items[0].getAsFile) {
        const file = items[0].getAsFile();
        if (file) {
          message.info("To initialize branches/commits, please drag and drop the root Git repository folder.");
        }
      }
    }
  };

  const handleLayerDoubleClick = (layerValue) => {
    if (soloLayer === layerValue) {
      setSoloLayer(null);
    } else {
      setSoloLayer(layerValue);
      if (!selectedLayers.includes(layerValue)) {
        setSelectedLayers([...selectedLayers, layerValue]);
      }
    }
  };

  const checkHealth = async () => {
    setBackendStatus('checking');
    try {
      const res = await fetch(`${API_BASE_URL}/api/health-check`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'healthy') {
          setBackendStatus('healthy');
          setKicadVersion(data.kicadVersion);
        } else {
          setBackendStatus('unhealthy');
        }
      } else {
        setBackendStatus('unhealthy');
      }
    } catch (e) {
      setBackendStatus('unhealthy');
    }
  };

  const handleFetchDiff = async (values) => {
    setLoading(true);
    const hideLoadingMsg = message.loading('Extracting and rendering commits...', 0);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/diff/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repoPath: values.repoPath,
          baseCommit: values.baseCommit,
          targetCommit: values.targetCommit,
          relativeFilePath: values.relativeFilePath,
          isPcb: values.relativeFilePath.endsWith('.kicad_pcb')
        }),
      });

      hideLoadingMsg();

      if (response.ok) {
        const data = await response.json();
        setDiffData(data);
        message.success('Diff loaded successfully!');
      } else {
        const errorData = await response.json();
        message.error(`Failed: ${errorData.error || 'Server error'}. ${errorData.details || ''}`, 5);
      }
    } catch (e) {
      hideLoadingMsg();
      message.error(`Connection error: ${e.message}`, 5);
    } finally {
      setLoading(false);
    }
  };

  const allLayers = [
    { value: 'F.Cu', label: 'F.Cu (Front Copper)' },
    { value: 'B.Cu', label: 'B.Cu (Back Copper)' },
    { value: 'In1.Cu', label: 'In1.Cu (Inner Copper 1)' },
    { value: 'In2.Cu', label: 'In2.Cu (Inner Copper 2)' },
    { value: 'In3.Cu', label: 'In3.Cu (Inner Copper 3)' },
    { value: 'In4.Cu', label: 'In4.Cu (Inner Copper 4)' },
    { value: 'F.SilkS', label: 'F.SilkS (Front Silkscreen)' },
    { value: 'B.SilkS', label: 'B.SilkS (Back Silkscreen)' },
    { value: 'F.Mask', label: 'F.Mask (Front Solder Mask)' },
    { value: 'B.Mask', label: 'B.Mask (Back Solder Mask)' },
    { value: 'F.Paste', label: 'F.Paste (Front Solder Paste)' },
    { value: 'B.Paste', label: 'B.Paste (Back Solder Paste)' },
    { value: 'F.Adhes', label: 'F.Adhes (Front Adhesive)' },
    { value: 'B.Adhes', label: 'B.Adhes (Back Adhesive)' },
    { value: 'Edge.Cuts', label: 'Edge.Cuts (Board Outline)' },
    { value: 'Margin', label: 'Margin (Board Margin)' },
    { value: 'F.Courtyard', label: 'F.Courtyard (Front Courtyard)' },
    { value: 'B.Courtyard', label: 'B.Courtyard (Back Courtyard)' },
    { value: 'F.Fab', label: 'F.Fab (Front Fabrication)' },
    { value: 'B.Fab', label: 'B.Fab (Back Fabrication)' },
    { value: 'Dwgs.User', label: 'Dwgs.User (Drawings User)' },
    { value: 'Cmts.User', label: 'Cmts.User (Comments User)' },
    { value: 'Eco1.User', label: 'Eco1.User (Eco 1 User)' },
    { value: 'Eco2.User', label: 'Eco2.User (Eco 2 User)' },
    { value: 'User.Drawings', label: 'User.Drawings (Drawings)' },
    { value: 'User.Comments', label: 'User.Comments (Comments)' },
    { value: 'User.Eco1', label: 'User.Eco1 (Eco 1)' },
    { value: 'User.Eco2', label: 'User.Eco2 (Eco 2)' }
  ];

  const filteredLayers = allLayers.filter(l => 
    l.label.toLowerCase().includes(layerFilter.toLowerCase()) || 
    l.value.toLowerCase().includes(layerFilter.toLowerCase())
  );

  // Helper to extract clean layer name from filename
  const getCleanLayerName = (filename) => {
    if (!filename) return 'Unknown';
    let name = filename.replace(/\.svg$/i, '');
    const lastHyphen = name.lastIndexOf('-');
    if (lastHyphen !== -1) {
      name = name.substring(lastHyphen + 1);
    }
    return name.replace('_', '.');
  };

  // Get dynamically generated logs based on diffData modifications
  const getAuditLogs = () => {
    if (!diffData || !diffData.modifications || diffData.modifications.length === 0) {
      return [
        {
          title: 'No active modifications',
          desc: 'Select commits and run the comparison to generate a real-time board audit log.',
          time: 'Info',
          color: '#a6adbb',
          type: 'info'
        }
      ];
    }

    const IGNORE_KEYWORDS = ['File:', 'Sheet:', 'Date:', 'Title:', 'KiCad E.D.A.', 'base_', 'target_'];

    // Group modifications by type + tag + unique ID + layer
    const grouped = {};

    for (const mod of diffData.modifications) {
      // 1. Title Block Keyword Suppression Filter
      if (mod.tag === 'text' && mod.text) {
        if (IGNORE_KEYWORDS.some(kw => mod.text.includes(kw))) {
          continue; // Skip this administrative text change
        }
      }

      const layerName = getCleanLayerName(mod.layer);
      
      // Determine if this is a named component or a generic shape
      const isGenericId = !mod.id || 
                          /^(path|rect|circle|line|poly|ellipse|text|use)\d+/i.test(mod.id) ||
                          /^[0-9]+$/.test(mod.id);
      const hasUniqueId = !isGenericId;
      
      // Create a grouping key
      const groupKey = mod.class === 'track_chain'
        ? `track_chain-${mod.diffIdx}`
        : (hasUniqueId 
            ? `unique-${mod.type}-${mod.id}-${layerName}`
            : `generic-${mod.type}-${mod.tag}-${layerName}`);

      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          type: mod.type,
          tag: mod.tag,
          id: mod.id,
          class: mod.class,
          net: mod.net ?? null,        // net name for track chains (null if backend doesn't supply)
          segmentCount: mod.segmentCount,
          label: mod.label,
          component: mod.component,
          text: mod.text,
          layerName,
          count: 1,
          texts: mod.text ? [mod.text] : [],
          // Navigation: use the first modification's DOM index and panel side
          diffIdx: mod.diffIdx,
          side:    mod.side ?? 'target',
          baseCoords: mod.baseCoords,
          targetCoords: mod.targetCoords,
        };
      } else {
        grouped[groupKey].count += 1;
        if (mod.text && !grouped[groupKey].texts.includes(mod.text)) {
          grouped[groupKey].texts.push(mod.text);
        }
      }
    }

    // Priority sorting: copper traces first, then vias/pads, then other copper, then others.
    const getPriority = (log) => {
      const isCopper = log.time && (log.time.endsWith('.Cu') || log.time.includes('_Cu'));
      const tag = log.tag ? log.tag.toLowerCase() : '';

      if (isCopper) {
        if (['path', 'line', 'polyline'].includes(tag)) {
          return 100; // Copper traces / tracks
        }
        if (['circle', 'ellipse', 'rect'].includes(tag)) {
          return 90; // Vias / footprint pads
        }
        return 80; // Other copper layer items
      }
      return 50; // Non-copper items (silkscreen, outline, etc.)
    };

    // Convert grouped modifications to structured card logs
    return Object.values(grouped).map((group) => {
      let title = '';
      let desc = '';
      let color = '#ffff00'; // yellow (modify)

      const countStr = group.count > 1 ? ` (${group.count}x)` : '';
      const isPlural = group.count > 1;

      const isCopper = group.layerName && (group.layerName.endsWith('.Cu') || group.layerName.includes('_Cu'));
      const isTrack = ['path', 'line', 'polyline'].includes(group.tag);
      const isViaOrPad = ['circle', 'ellipse', 'rect'].includes(group.tag);

      if (group.type === 'add') {
        color = '#00ff66'; // neon green
        if (group.component && group.component !== 'Component') {
          title = group.label || `Added ${group.id}`;
          desc = `New ${group.component} placed on layer ${group.layerName}.`;
        } else if (isCopper && isTrack) {
          title = `Added Copper Track${isPlural ? 's' : ''}${countStr}`;
          desc = `New trace connection segment routed on layer ${group.layerName}.`;
        } else if (isCopper && isViaOrPad) {
          title = `Added Via / Pad${isPlural ? 's' : ''}${countStr}`;
          desc = `New via or component pad connection added on layer ${group.layerName}.`;
        } else if (group.id && group.count === 1) {
          title = `Added ${group.id}`;
          desc = `Added component/shape ${group.tag} on layer ${group.layerName}.`;
        } else {
          title = `Added ${group.tag.toUpperCase()}s${countStr}`;
          desc = `Added ${group.count} new ${group.tag} element(s) on layer ${group.layerName}.`;
        }
        if (group.texts.length > 0) desc += ` Text: "${group.texts.join(', ')}".`;
      } else if (group.type === 'delete') {
        color = '#ff3366'; // crimson red
        if (group.component && group.component !== 'Component') {
          title = group.label || `Deleted ${group.id}`;
          desc = `Removed ${group.component} from layer ${group.layerName}.`;
        } else if (isCopper && isTrack) {
          title = `Removed Copper Track${isPlural ? 's' : ''}${countStr}`;
          desc = `Removed trace connection segment from layer ${group.layerName}.`;
        } else if (isCopper && isViaOrPad) {
          title = `Removed Via / Pad${isPlural ? 's' : ''}${countStr}`;
          desc = `Removed via or component pad connection from layer ${group.layerName}.`;
        } else if (group.id && group.count === 1) {
          title = `Deleted ${group.id}`;
          desc = `Removed component/shape ${group.tag} from layer ${group.layerName}.`;
        } else {
          title = `Deleted ${group.tag.toUpperCase()}s${countStr}`;
          desc = `Removed ${group.count} ${group.tag} element(s) from layer ${group.layerName}.`;
        }
        if (group.texts.length > 0) desc += ` Text: "${group.texts.join(', ')}".`;
      } else if (group.type === 'modify') {
        color = '#ffff00'; // golden yellow
        if (group.class === 'track_chain') {
          // Use net name if backend supplies it; otherwise be honest — don't fabricate a location.
          const netLabel = group.net && group.net.trim() ? group.net.trim() : null;
          const segInfo = group.segmentCount ? ` (${group.segmentCount} segs)` : '';
          title = netLabel ? `${netLabel} re-routed${segInfo}` : `Trace re-routed${segInfo}`;
          desc = `Adjusted track chain on layer ${group.layerName}.`;
        } else if (group.component && group.component !== 'Component') {
          title = group.label || `Modified ${group.id}`;
          desc = `Modified ${group.component} layout/values on layer ${group.layerName}.`;
        } else if (isCopper && isTrack) {
          title = `Shifted Track Segment${isPlural ? 's' : ''}${countStr}`;
          desc = `Adjusted trace routing geometry on layer ${group.layerName}.`;
        } else if (isCopper && isViaOrPad) {
          title = `Adjusted Pad / Via${isPlural ? 's' : ''}${countStr}`;
          desc = `Modified pad/via sizing, shape or positional alignment on layer ${group.layerName}.`;
        } else if (group.id && group.count === 1) {
          title = `Modified ${group.id}`;
          desc = `Updated component/shape ${group.tag} on layer ${group.layerName}.`;
        } else {
          title = `Modified ${group.tag.toUpperCase()}s${countStr}`;
          desc = `Modified layout of ${group.count} ${group.tag} element(s) on layer ${group.layerName}.`;
        }
        if (group.texts.length > 0) desc += ` Text: "${group.texts.join(', ')}".`;
      } else if (group.type === 'add_layer') {
        title = `Added Layer`;
        desc = `Entire layer file ${group.id} was added.`;
        color = '#00ff66';
      } else if (group.type === 'delete_layer') {
        title = `Removed Layer`;
        desc = `Entire layer file ${group.id} was removed.`;
        color = '#ff3366';
      }

      return {
        title,
        desc,
        time: group.layerName,
        type: group.type,
        color,
        tag: group.tag,
        // Navigation payload — forwarded to SideBySideDiff.focusElement()
        diffIdx: group.diffIdx,
        side:    group.side,
        rawType: group.type,   // 'add' | 'delete' | 'modify'
        baseCoords: group.baseCoords,
        targetCoords: group.targetCoords,
      };
    }).sort((a, b) => getPriority(b) - getPriority(a));
  };

  const handleAuditItemSelect = (item, idx) => {
    if (!item) return;
    setActiveAuditIdx(idx);

    let layerWasMissing = false;
    const itemLayer = item.layer || item.time;
    if (itemLayer && !selectedLayers.includes(itemLayer)) {
      layerWasMissing = true;
      setSelectedLayers(prev => [...prev, itemLayer]);
    }

    const rawType = item.type || item.diffType || item.rawType || '';
    const diffType = rawType.startsWith('add')
      ? 'add'
      : rawType.startsWith('delete')
      ? 'delete'
      : 'change';

    const focusPayload = {
      diffIdx: item.diffIdx,
      side: item.side ?? (diffType === 'delete' ? 'base' : 'target'),
      diffType,
      baseCoords: item.baseCoords,
      targetCoords: item.targetCoords,
      bbox: item.bbox,
    };

    const triggerFocus = () => {
      if (diffMode === 'Side by Side') {
        if (sideBySideRef.current) {
          sideBySideRef.current.focusElement(focusPayload);
        }
      } else {
        if (diffCanvasRef.current) {
          diffCanvasRef.current.focusElement(focusPayload);
        }
      }
    };

    triggerFocus();
    if (layerWasMissing) {
      setTimeout(triggerFocus, 60);
    }
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#fadb14', // Banana Yellow/Gold
          colorBgBase: '#0f1015', // Sleek deep dark grey
          borderRadius: 6,
        },
      }}
    >
      <Layout style={{ minHeight: '100vh', background: '#0f1015' }}>
        {/* Header */}
        <WorkspaceShell
          activeStudio={activeStudio}
          onSelectStudio={setActiveStudio}
          circuits={circuits}
          activeCircuitId={activeCircuitId}
          onSelectCircuit={setActiveCircuitId}
          onNewCircuit={() => {
            setCopilotMode('builder');
            setIsCopilotOpen(true);
          }}
          onOpenCopilot={(targetMode) => {
            const mode = targetMode || (activeStudio === 'builder' ? 'builder' : 'chat');
            setCopilotMode(mode);
            setIsCopilotOpen(true);
          }}
          kicadVersion={kicadVersion}
          backendStatus={backendStatus}
        />

        {activeStudio === 'diff' && (
          <Layout>
            {/* Left Sidebar - Controls */}
            <Sider 
              width={340} 
            collapsible 
            collapsed={leftCollapsed} 
            collapsedWidth={0}
            trigger={null}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFolderDrop}
            style={{ 
              background: '#161821', 
              borderRight: leftCollapsed ? 'none' : '1px solid #232738', 
              padding: leftCollapsed ? 0 : '20px',
              overflowY: 'auto',
              height: 'calc(100vh - 64px)',
              transition: 'all 0.2s'
            }}
          >
            {!leftCollapsed && (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <Title level={5} style={{ margin: 0, color: '#f5f5f5', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <SettingOutlined /> Repository Configuration
                    </Title>
                    <Button
                      type="text"
                      size="small"
                      icon={<MenuFoldOutlined />}
                      onClick={() => setLeftCollapsed(true)}
                      title="Hide Controls (Left Panel)"
                      style={{ color: '#94a3b8' }}
                    />
                  </div>
                  <Upload.Dragger
                    directory
                    multiple={false}
                    showUploadList={false}
                    beforeUpload={(file) => {
                      handleFileDraggedOrDropped(file);
                      return false;
                    }}
                    style={{ 
                      background: '#0f1015', 
                      borderColor: '#232738',
                      borderRadius: '4px',
                      marginBottom: '15px',
                      padding: '10px 0'
                    }}
                  >
                    <p className="ant-upload-drag-icon" style={{ color: '#faad14', margin: 0 }}>
                      <InboxOutlined style={{ fontSize: '24px' }} />
                    </p>
                    <p className="ant-upload-text" style={{ fontSize: '12px', color: '#f5f5f5', margin: '4px 0 0' }}>
                      Drag KiCad Project Folder Here
                    </p>
                    <p className="ant-upload-hint" style={{ fontSize: '10px', color: '#6b6375', margin: 0 }}>
                      Supports entire directory drops containing .kicad_pcb/.kicad_sch
                    </p>
                  </Upload.Dragger>
                  <Form
                    form={form}
                    layout="vertical"
                    initialValues={{
                      repoPath,
                      baseCommit,
                      targetCommit,
                      relativeFilePath
                    }}
                    onFinish={handleFetchDiff}
                  >
                    <Form.Item 
                      label="Local Repo Root Absolute Path" 
                      name="repoPath" 
                      rules={[{ required: true, message: 'Please input absolute repo path' }]}
                      style={{ marginBottom: '8px' }}
                    >
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <Input 
                          placeholder="e.g. C:\Users\project" 
                          onChange={(e) => {
                            setRepoPath(e.target.value);
                            form.setFieldValue('repoPath', e.target.value);
                          }} 
                        />
                        <Button type="default" onClick={() => loadRepoInfo(repoPath, false)}>Load</Button>
                      </div>
                    </Form.Item>
                    <Alert
                      message="Sandbox Security Notice"
                      description="Because of browser sandbox security, please verify your local absolute repository path above so the Git engine can target it on disk."
                      type="info"
                      showIcon
                      style={{ 
                        marginBottom: '15px', 
                        background: '#161722', 
                        borderColor: '#232738',
                        fontSize: '11px',
                        color: '#a6adbb'
                      }}
                    />
                    <Form.Item label="Compare Branches instead of Commits" valuePropName="checked" style={{ marginBottom: '12px' }}>
                      <Switch 
                        checked={compareBranches} 
                        onChange={(checked) => {
                          setCompareBranches(checked);
                          setBaseCommit('');
                          setTargetCommit('');
                          form.setFieldsValue({ baseCommit: '', targetCommit: '' });
                          if (checked) {
                            setChangedFiles([]);
                            setRelativeFilePath('');
                            form.setFieldValue('relativeFilePath', '');
                          }
                        }} 
                      />
                    </Form.Item>
                    <Form.Item 
                      label={compareBranches ? "Base Branch" : "Base Commit"} 
                      name="baseCommit" 
                      rules={[{ required: true, message: 'Please select base version' }]}
                    >
                      {!repoInfo ? (
                        <Input placeholder="e.g. HEAD~1 or commit hash" onChange={(e) => setBaseCommit(e.target.value)} />
                      ) : (
                        <Select
                          showSearch
                          placeholder={compareBranches ? "Select base branch" : "Select base commit"}
                          onChange={(val) => {
                            setBaseCommit(val);
                            form.setFieldValue('baseCommit', val);
                            if (compareBranches && targetCommit) {
                              fetchChangedFiles(repoPath, val, targetCommit);
                            }
                          }}
                          value={baseCommit}
                        >
                          {compareBranches ? (
                            repoInfo.branches.map(b => (
                              <Select.Option key={`base-branch-${b}`} value={b}>{b}</Select.Option>
                            ))
                          ) : (
                            repoInfo.commits.map(c => (
                              <Select.Option key={`base-commit-${c.hash}`} value={c.hash}>
                                {c.hash.substring(0, 7)} - {c.subject} ({c.author})
                              </Select.Option>
                            ))
                          )}
                        </Select>
                      )}
                    </Form.Item>
                    <Form.Item 
                      label={compareBranches ? "Target Branch" : "Target Commit"} 
                      name="targetCommit" 
                      rules={[{ required: true, message: 'Please select target version' }]}
                    >
                      {!repoInfo ? (
                        <Input placeholder="e.g. HEAD or commit hash" onChange={(e) => setTargetCommit(e.target.value)} />
                      ) : (
                        <Select
                          showSearch
                          placeholder={compareBranches ? "Select target branch" : "Select target commit"}
                          onChange={(val) => {
                            setTargetCommit(val);
                            form.setFieldValue('targetCommit', val);
                            if (compareBranches && baseCommit) {
                              fetchChangedFiles(repoPath, baseCommit, val);
                            }
                          }}
                          value={targetCommit}
                        >
                          {compareBranches ? (
                            repoInfo.branches.map(b => (
                              <Select.Option key={`target-branch-${b}`} value={b}>{b}</Select.Option>
                            ))
                          ) : (
                            repoInfo.commits.map(c => (
                              <Select.Option key={`target-commit-${c.hash}`} value={c.hash}>
                                {c.hash.substring(0, 7)} - {c.subject} ({c.author})
                              </Select.Option>
                            ))
                          )}
                        </Select>
                      )}
                    </Form.Item>
                    <Form.Item 
                      label="Design File Path" 
                      name="relativeFilePath" 
                      rules={[{ required: true, message: 'Please select file path' }]}
                    >
                      {compareBranches ? (
                        !changedFiles || changedFiles.length === 0 ? (
                          <Select placeholder="No changed KiCad files found" disabled />
                        ) : (
                          <Select
                            showSearch
                            placeholder="Select changed KiCad file"
                            onChange={(val) => {
                              setRelativeFilePath(val);
                              form.setFieldValue('relativeFilePath', val);
                            }}
                            value={relativeFilePath}
                          >
                            {changedFiles.map(file => (
                              <Select.Option key={`changed-${file}`} value={file}>{file}</Select.Option>
                            ))}
                          </Select>
                        )
                      ) : (
                        !repoInfo?.kicadFiles || repoInfo.kicadFiles.length === 0 ? (
                          <Input placeholder="e.g. layout/board.kicad_pcb" onChange={(e) => setRelativeFilePath(e.target.value)} />
                        ) : (
                          <Select
                            showSearch
                            placeholder="Select KiCad file"
                            onChange={(val) => {
                              setRelativeFilePath(val);
                              form.setFieldValue('relativeFilePath', val);
                            }}
                            value={relativeFilePath}
                          >
                            {repoInfo.kicadFiles.map(file => (
                              <Select.Option key={`file-${file}`} value={file}>{file}</Select.Option>
                            ))}
                          </Select>
                        )
                      )}
                    </Form.Item>
                    <Form.Item>
                      <Button type="primary" htmlType="submit" icon={<FileSearchOutlined />} loading={loading} block>
                        Fetch and Render Diff
                      </Button>
                    </Form.Item>
                  </Form>
                  {repoInfo?.commits && repoInfo.commits.length > 0 && (
                    <div style={{ borderTop: '1px solid #232738', paddingTop: '20px', marginTop: '20px' }}>
                      <Title level={5} style={{ color: '#fadb14', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px' }}>
                        <HistoryOutlined /> Recent Git Commits
                      </Title>
                      <div style={{ maxHeight: '200px', overflowY: 'auto', paddingRight: '5px' }}>
                        <Timeline
                          pending={false}
                          mode="left"
                          items={repoInfo.commits.slice(0, 15).map((c, idx) => ({
                            color: idx === 0 ? '#faad14' : '#6b6375',
                            children: (
                              <div style={{ fontSize: '11px', color: '#a6adbb' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                  <Text strong style={{ color: '#f5f5f5', fontSize: '11px' }}>{c.hash.substring(0, 7)}</Text>
                                  <Text type="secondary" style={{ fontSize: '10px' }}>{c.date}</Text>
                                </div>
                                <div style={{ lineHeight: '1.3' }}>{c.subject}</div>
                                <div style={{ fontSize: '10px', color: '#6b6375', marginTop: '2px' }}>by {c.author}</div>
                              </div>
                            )
                          }))}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ borderTop: '1px solid #232738', paddingTop: '20px' }}>
                  <Title level={5} style={{ color: '#f5f5f5' }}>Visual Diff Mode</Title>
                  <Segmented
                    block
                    options={['Overlay Slider', 'Color Delta Map', 'Side by Side']}
                    value={diffMode}
                    onChange={setDiffMode}
                    style={{ marginBottom: '20px', background: '#0f1015' }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <Title level={5} style={{ color: '#f5f5f5', margin: 0 }}>Active Layers (PCB)</Title>
                      <Text type="secondary" style={{ fontSize: '10px' }}>Double click to solo layer</Text>
                    </div>
                    <Space size="small">
                      <Button 
                        type="link" 
                        size="small" 
                        style={{ padding: 0, fontSize: '11px', color: '#fadb14' }}
                        onClick={() => setSelectedLayers(allLayers.map(l => l.value))}
                      >
                        Select All
                      </Button>
                      <Text type="secondary" style={{ fontSize: '10px' }}>|</Text>
                      <Button 
                        type="link" 
                        size="small" 
                        style={{ padding: 0, fontSize: '11px', color: '#fadb14' }}
                        onClick={() => setSelectedLayers([])}
                      >
                        Clear
                      </Button>
                    </Space>
                  </div>

                  <Input 
                    placeholder="Search layers..." 
                    value={layerFilter}
                    onChange={(e) => setLayerFilter(e.target.value)}
                    style={{ marginBottom: '10px', background: '#0f1015', borderColor: '#232738' }}
                    size="small"
                  />

                  <div style={{
                    height: '180px',
                    overflowY: 'auto',
                    border: '1px solid #232738',
                    borderRadius: '4px',
                    padding: '8px 12px',
                    background: '#0f1015'
                  }}>
                    <Checkbox.Group
                      value={selectedLayers}
                      onChange={setSelectedLayers}
                      style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}
                    >
                      {filteredLayers.map(l => {
                        const isActive = selectedLayers.includes(l.value);
                        const layerOp = layerOpacities[l.value] ?? 1;
                        return (
                          <div
                            key={l.value}
                            onDoubleClick={() => handleLayerDoubleClick(l.value)}
                            style={{
                              userSelect: 'none',
                              padding: '3px 6px 4px',
                              borderRadius: '4px',
                              background: soloLayer === l.value ? 'rgba(250, 219, 20, 0.12)' : 'transparent',
                              border: soloLayer === l.value ? '1px dashed #fadb14' : '1px solid transparent',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                            title="Double click to Solo this layer"
                          >
                            {/* Row 1: checkbox + label */}
                            <Checkbox value={l.value} style={{ margin: 0, color: '#a6adbb', fontSize: '12px' }}>
                              {l.label}{soloLayer === l.value && <span style={{ color: '#fadb14', fontSize: '10px', marginLeft: '5px' }}>(Soloed)</span>}
                            </Checkbox>

                            {/* Row 2: opacity slider — only when layer is active */}
                            {isActive && (
                              <div
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px', paddingLeft: '24px' }}
                                onClick={e => e.stopPropagation()}
                                onDoubleClick={e => e.stopPropagation()}
                              >
                                <Slider
                                  min={0}
                                  max={100}
                                  value={Math.round(layerOp * 100)}
                                  onChange={v => setLayerOpacities(prev => ({ ...prev, [l.value]: v / 100 }))}
                                  style={{ flex: 1, margin: 0 }}
                                  tooltip={{ formatter: v => `${v}%` }}
                                  styles={{
                                    track: { background: '#fadb14', height: 2 },
                                    rail:  { background: '#2a2a38', height: 2 },
                                    handle: { width: 10, height: 10, marginTop: -4 },
                                  }}
                                />
                                <Text style={{ fontSize: '10px', color: '#6b6375', width: '30px', textAlign: 'right', flexShrink: 0 }}>
                                  {Math.round(layerOp * 100)}%
                                </Text>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {filteredLayers.length === 0 && (
                        <div style={{ color: '#6b6375', textAlign: 'center', fontSize: '12px', padding: '10px 0' }}>
                          No layers match filter
                        </div>
                      )}
                    </Checkbox.Group>
                  </div>
                </div>
              </Space>
            )}
          </Sider>

          {/* Center Content - Viewport */}
          <Content style={{ 
            padding: '20px', 
            display: 'flex', 
            flexDirection: 'column', 
            justifyContent: 'center', 
            alignItems: 'center',
            height: 'calc(100vh - 64px)',
            overflow: 'hidden',
            position: 'relative'
          }}>
            {/* Left Edge Tab to Unhide Left Panel */}
            {leftCollapsed && (
              <div
                onClick={() => setLeftCollapsed(false)}
                title="Show Controls Panel"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 200,
                  background: '#161821',
                  border: '1px solid #fadb14',
                  borderLeft: 'none',
                  borderRadius: '0 6px 6px 0',
                  padding: '10px 5px',
                  cursor: 'pointer',
                  boxShadow: '2px 0 10px rgba(0,0,0,0.5)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  color: '#fadb14'
                }}
              >
                <MenuUnfoldOutlined style={{ fontSize: '14px' }} />
                <span style={{ writingMode: 'vertical-rl', fontSize: '10px', letterSpacing: '1px', fontWeight: 700 }}>CONTROLS</span>
              </div>
            )}

            {/* Right Edge Tab to Unhide Right Panel */}
            {rightCollapsed && (
              <div
                onClick={() => setRightCollapsed(false)}
                title="Show Audit Modifications Panel"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 200,
                  background: '#161821',
                  border: '1px solid #fadb14',
                  borderRight: 'none',
                  borderRadius: '6px 0 0 6px',
                  padding: '10px 5px',
                  cursor: 'pointer',
                  boxShadow: '-2px 0 10px rgba(0,0,0,0.5)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  color: '#fadb14'
                }}
              >
                <MenuFoldOutlined style={{ fontSize: '14px' }} />
                <span style={{ writingMode: 'vertical-rl', fontSize: '10px', letterSpacing: '1px', fontWeight: 700 }}>AUDIT</span>
              </div>
            )}

            {!diffData ? (
              <Card style={{ 
                width: '100%', 
                maxWidth: '600px', 
                background: '#161821', 
                borderColor: '#232738',
                borderRadius: '8px' 
              }}>
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <Space direction="vertical" size="small" align="center">
                      <Text style={{ fontSize: 16, color: '#a6adbb' }}>No Diff Loaded</Text>
                      <Text type="secondary" style={{ fontSize: 13 }}>
                        Configure the Git repository and commits on the left sidebar, then click "Fetch and Render Diff" to process layouts.
                      </Text>
                    </Space>
                  }
                />
              </Card>
            ) : (
              <Card 
                title={
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Button
                        type="text"
                        size="small"
                        icon={leftCollapsed ? <MenuUnfoldOutlined style={{ color: '#fadb14' }} /> : <MenuFoldOutlined style={{ color: '#a6adbb' }} />}
                        onClick={() => setLeftCollapsed(!leftCollapsed)}
                        style={{
                          background: leftCollapsed ? 'rgba(250, 219, 20, 0.15)' : '#1e2230',
                          border: '1px solid',
                          borderColor: leftCollapsed ? '#fadb14' : '#2a2f42',
                          color: leftCollapsed ? '#fadb14' : '#cbd5e1',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '2px 8px',
                          height: '26px',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      >
                        <span style={{ fontSize: '11px', fontWeight: 600 }}>
                          {leftCollapsed ? 'Show Controls' : 'Hide Controls'}
                        </span>
                      </Button>
                      <span style={{ color: '#faad14', fontWeight: 600, fontSize: '13px' }}>
                        Diff Viewport ({relativeFilePath})
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Button
                        type="text"
                        size="small"
                        icon={rightCollapsed ? <MenuFoldOutlined style={{ color: '#fadb14' }} /> : <MenuUnfoldOutlined style={{ color: '#a6adbb' }} />}
                        onClick={() => setRightCollapsed(!rightCollapsed)}
                        style={{
                          background: rightCollapsed ? 'rgba(250, 219, 20, 0.15)' : '#1e2230',
                          border: '1px solid',
                          borderColor: rightCollapsed ? '#fadb14' : '#2a2f42',
                          color: rightCollapsed ? '#fadb14' : '#cbd5e1',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '2px 8px',
                          height: '26px',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      >
                        <span style={{ fontSize: '11px', fontWeight: 600 }}>
                          {rightCollapsed ? 'Show Audit' : 'Hide Audit'}
                        </span>
                      </Button>
                    </div>
                  </div>
                }
                style={{ 
                  width: '100%', 
                  height: '100%', 
                  background: '#161821', 
                  borderColor: '#232738',
                  display: 'flex',
                  flexDirection: 'column'
                }}
                bodyStyle={{ 
                  flex: 1, 
                  display: 'flex', 
                  flexDirection: 'column', 
                  padding: '20px', 
                  overflow: 'hidden' 
                }}
              >
                <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                  {diffMode === 'Side by Side' ? (
                  <SideBySideDiff
                      ref={sideBySideRef}
                      isSchematic={relativeFilePath ? relativeFilePath.endsWith('.kicad_sch') : false}
                      baseSvgs={diffData.sideBySide?.base ?? diffData.base?.svgs}
                      targetSvgs={diffData.sideBySide?.target ?? diffData.target?.svgs}
                      activeLayers={selectedLayers}
                      soloLayer={soloLayer}
                      layerOpacities={layerOpacities}
                      baseCommit={baseCommit}
                      targetCommit={targetCommit}
                      activeAuditIdx={activeAuditIdx}
                      setActiveAuditIdx={setActiveAuditIdx}
                      padLabelProps={
                        relativeFilePath.endsWith('.kicad_pcb')
                          ? { repoPath, baseCommit, targetCommit, relativeFilePath }
                          : null
                      }
                    />
                  ) : (
                    <DiffCanvas
                      ref={diffCanvasRef}
                      baseSvgs={diffData.base?.svgs}
                      targetSvgs={diffData.target?.svgs}
                      diffMode={diffMode}
                      activeLayers={selectedLayers}
                      sliderValue={sliderValue}
                      onSliderChange={setSliderValue}
                      soloLayer={soloLayer}
                      layerOpacities={layerOpacities}
                      baseCommit={baseCommit}
                      targetCommit={targetCommit}
                      activeAuditIdx={activeAuditIdx}
                      setActiveAuditIdx={setActiveAuditIdx}
                    />
                  )}
                </div>
                {diffMode === 'Overlay Slider' && (
                  <div style={{ marginTop: '15px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <Text type="secondary">Base Commit ({baseCommit})</Text>
                      <Text type="warning">Split: {sliderValue}%</Text>
                      <Text type="secondary">Target Commit ({targetCommit})</Text>
                    </div>
                    <Slider
                      min={0}
                      max={100}
                      value={sliderValue}
                      onChange={setSliderValue}
                      tooltip={{ formatter: (v) => `Split: ${v}%` }}
                    />
                  </div>
                )}
              </Card>
            )}
          </Content>

          {/* Right Sidebar - Audit Log */}
          <Sider 
            width={320} 
            collapsible 
            collapsed={rightCollapsed} 
            collapsedWidth={0}
            trigger={null}
            style={{ 
              background: 'rgba(15, 23, 42, 0.95)', 
              borderLeft: rightCollapsed ? 'none' : '1px solid #1e293b', 
              padding: 0,
              overflowY: 'hidden',
              height: 'calc(100vh - 64px)',
              transition: 'all 0.2s'
            }}
          >
            {!rightCollapsed && (
              <AuditSidebar
                modifications={
                  diffData?.modifications && diffData.modifications.length > 0
                    ? diffData.modifications
                    : (() => {
                        const logs = getAuditLogs();
                        if (!logs || logs.length === 0 || logs[0].type === 'info') return [];

                        return logs.map((log) => {
                          const action = log.rawType === 'add' || log.rawType === 'add_layer'
                            ? 'ADDED'
                            : (log.rawType === 'delete' || log.rawType === 'delete_layer' ? 'DELETED' : 'CHANGED');

                          return {
                            action,
                            layer: log.time || 'F.Cu',
                            name: log.title,
                            title: log.title,
                            detail: log.desc,
                            diffIdx: log.diffIdx,
                            side: log.side ?? 'target',
                            rawType: log.rawType,
                            baseCoords: log.baseCoords,
                            targetCoords: log.targetCoords,
                            bbox: log.bbox
                          };
                        });
                      })()
                }
                activeDiffIdx={activeAuditIdx}
                onHoverDiff={(diffIdx) => {
                  if (diffMode === 'Side by Side') {
                    if (sideBySideRef.current) {
                      sideBySideRef.current.setHoveredDiff(diffIdx);
                    }
                  } else {
                    if (diffCanvasRef.current) {
                      diffCanvasRef.current.setHoveredDiff(diffIdx);
                    }
                  }
                }}
                onSelectDiff={(item) => {
                  setActiveAuditIdx(item.diffIdx);

                  // Ensure layer containing this diff is active in selectedLayers
                  const cleanLayer = getCleanLayerName(item.layer);
                  const layerWasMissing = cleanLayer && cleanLayer !== 'Unknown' && !selectedLayers.includes(cleanLayer);
                  if (layerWasMissing) {
                    setSelectedLayers(prev => [...prev, cleanLayer]);
                  }

                  const rawAction = (item.action ? item.action.toLowerCase() : item.rawType) || 'changed';
                  const diffType = rawAction === 'added' ? 'add' : (rawAction === 'deleted' ? 'delete' : rawAction);

                  const focusPayload = {
                    diffIdx: item.diffIdx,
                    side: item.side ?? (diffType === 'delete' ? 'base' : 'target'),
                    diffType,
                    baseCoords: item.baseCoords,
                    targetCoords: item.targetCoords,
                    bbox: item.bbox,
                  };

                  const triggerFocus = () => {
                    if (diffMode === 'Side by Side') {
                      if (sideBySideRef.current) {
                        sideBySideRef.current.focusElement(focusPayload);
                      }
                    } else {
                      if (diffCanvasRef.current) {
                        diffCanvasRef.current.focusElement(focusPayload);
                      }
                    }
                  };

                  triggerFocus();
                  if (layerWasMissing) {
                    setTimeout(triggerFocus, 60);
                  }
                }}
                onCollapse={() => setRightCollapsed(true)}
              />
            )}
          </Sider>
        </Layout>
      )}

      {/* Circuit Builder Studio Viewport */}
      {activeStudio === 'builder' && (
        <div style={{ height: 'calc(100vh - 56px)', overflow: 'hidden' }}>
          <CircuitBuilderCanvas
            circuit={activeCircuit}
            onOpenSourcingHub={() => setActiveStudio('sourcing')}
            onExportKicad={() => {}}
          />
        </div>
      )}

      {/* Component Sourcing Hub Viewport */}
      {activeStudio === 'sourcing' && (
        <div style={{ height: 'calc(100vh - 56px)', overflow: 'hidden' }}>
          <ComponentSourcingHub
            activeCircuit={activeCircuit}
            onSubstituteComponent={(origPart, alt) => {
              if (activeCircuit) {
                const updatedComps = (activeCircuit.components || []).map(c => {
                  if (c.value === origPart || c.name === origPart) {
                    return {
                      ...c,
                      value: alt.partNumber,
                      name: alt.partNumber,
                      package: alt.package || c.package,
                      unitPrice: alt.unitPrice || c.unitPrice
                    };
                  }
                  return c;
                });
                const updatedCircuit = { ...activeCircuit, components: updatedComps };
                setCircuits(prev => prev.map(c => c.id === updatedCircuit.id ? updatedCircuit : c));
              }
            }}
          />
        </div>
      )}

      {/* Floating Copilot Button */}
      {!isCopilotOpen && (
        <div
          className="copilot-float-btn"
          onClick={() => setIsCopilotOpen(true)}
          style={{
            right: rightCollapsed ? '24px' : '300px'
          }}
          title="Open Banana Hardware Copilot (Gemini 3 Flash Preview)"
        >
          <span className="copilot-dot-pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: '#52c41a' }}></span>
          <span>Copilot ✨</span>
        </div>
      )}

      {/* AI Hardware Copilot Drawer */}
      <ChatbotDrawer
        open={isCopilotOpen}
        onClose={() => setIsCopilotOpen(false)}
        copilotMode={copilotMode}
        onSetCopilotMode={setCopilotMode}
        boardContext={{
          relativeFilePath,
          baseCommit,
          targetCommit,
          selectedLayers,
          diffMode,
          modifications: diffData?.modifications || [],
          pcbMetadata: diffData?.pcbMetadata
        }}
        onSelectModification={(modId, label) => {
          const mods = diffData?.modifications || [];
          const idx = mods.findIndex(m => m.id === modId || (label && (m.label?.includes(label) || m.text?.includes(label))));
          if (idx !== -1) {
            handleAuditItemSelect(mods[idx], idx);
          }
        }}
        onCircuitBuilt={(newCircuit) => {
          setCircuits(prev => [newCircuit, ...prev.filter(c => c.id !== newCircuit.id)]);
          setActiveCircuitId(newCircuit.id);
          setActiveStudio('builder');
          message.success(`Circuit "${newCircuit.title}" ready in Studio!`);
        }}
      />
    </Layout>
  </ConfigProvider>
  );
}
