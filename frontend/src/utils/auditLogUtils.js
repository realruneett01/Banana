const IGNORE_KEYWORDS = ['File:', 'Sheet:', 'Date:', 'Title:', 'KiCad E.D.A.', 'base_', 'target_'];

export function getCleanLayerName(filename) {
  if (!filename) return 'Unknown';
  let name = filename.replace(/\.svg$/i, '');
  const lastHyphen = name.lastIndexOf('-');
  if (lastHyphen !== -1) {
    name = name.substring(lastHyphen + 1);
  }
  return name.replace('_', '.');
}

function isGenericShapeId(id) {
  return !id ||
    /^(path|rect|circle|line|poly|ellipse|text|use)\d+/i.test(id) ||
    /^[0-9]+$/.test(id);
}

function resolveGroupKey(mod, layerName) {
  if (mod.class === 'track_chain') {
    return `track_chain-${mod.diffIdx}`;
  }
  const hasUniqueId = !isGenericShapeId(mod.id);
  return hasUniqueId
    ? `unique-${mod.type}-${mod.id}-${layerName}`
    : `generic-${mod.type}-${mod.tag}-${layerName}`;
}

function createGroupEntry(mod, layerName) {
  return {
    type: mod.type,
    tag: mod.tag,
    id: mod.id,
    class: mod.class,
    net: mod.net ?? null,
    segmentCount: mod.segmentCount,
    label: mod.label,
    component: mod.component,
    text: mod.text,
    layerName,
    count: 1,
    texts: mod.text ? [mod.text] : [],
    diffIdx: mod.diffIdx,
    side: mod.side ?? 'target',
    baseCoords: mod.baseCoords,
    targetCoords: mod.targetCoords,
  };
}

function groupModifications(modifications) {
  const grouped = {};

  for (const mod of modifications) {
    if (mod.tag === 'text' && mod.text && IGNORE_KEYWORDS.some((kw) => mod.text.includes(kw))) {
      continue;
    }

    const layerName = getCleanLayerName(mod.layer);
    const key = resolveGroupKey(mod, layerName);

    if (!grouped[key]) {
      grouped[key] = createGroupEntry(mod, layerName);
    } else {
      grouped[key].count += 1;
      if (mod.text && !grouped[key].texts.includes(mod.text)) {
        grouped[key].texts.push(mod.text);
      }
    }
  }

  return Object.values(grouped);
}

function getPriority(log) {
  const isCopper = log.time && (log.time.endsWith('.Cu') || log.time.includes('_Cu'));
  const tag = log.tag ? log.tag.toLowerCase() : '';

  if (isCopper) {
    if (['path', 'line', 'polyline'].includes(tag)) return 100;
    if (['circle', 'ellipse', 'rect'].includes(tag)) return 90;
    return 80;
  }
  return 50;
}

const ACTION_VOCAB = {
  add: {
    verb: 'Added',
    componentDesc: (c, l) => `New ${c} placed on layer ${l}.`,
    trackTitle: (p, c) => `Added Copper Track${p ? 's' : ''}${c}`,
    trackDesc: (l) => `New trace connection segment routed on layer ${l}.`,
    viaTitle: (p, c) => `Added Via / Pad${p ? 's' : ''}${c}`,
    viaDesc: (l) => `New via or component pad connection added on layer ${l}.`,
    shapeDesc: (tag, l) => `Added component/shape ${tag} on layer ${l}.`,
    defaultDesc: (cnt, tag, l) => `Added ${cnt} new ${tag} element(s) on layer ${l}.`,
    color: '#00ff66'
  },
  delete: {
    verb: 'Deleted',
    componentDesc: (c, l) => `Removed ${c} from layer ${l}.`,
    trackTitle: (p, c) => `Removed Copper Track${p ? 's' : ''}${c}`,
    trackDesc: (l) => `Removed trace connection segment from layer ${l}.`,
    viaTitle: (p, c) => `Removed Via / Pad${p ? 's' : ''}${c}`,
    viaDesc: (l) => `Removed via or component pad connection from layer ${l}.`,
    shapeDesc: (tag, l) => `Removed component/shape ${tag} from layer ${l}.`,
    defaultDesc: (cnt, tag, l) => `Removed ${cnt} ${tag} element(s) from layer ${l}.`,
    color: '#ff3366'
  },
  modify: {
    verb: 'Modified',
    componentDesc: (c, l) => `Modified ${c} layout/values on layer ${l}.`,
    trackTitle: (p, c) => `Shifted Track Segment${p ? 's' : ''}${c}`,
    trackDesc: (l) => `Adjusted trace routing geometry on layer ${l}.`,
    viaTitle: (p, c) => `Adjusted Pad / Via${p ? 's' : ''}${c}`,
    viaDesc: (l) => `Modified pad/via sizing, shape or positional alignment on layer ${l}.`,
    shapeDesc: (tag, l) => `Updated component/shape ${tag} on layer ${l}.`,
    defaultDesc: (cnt, tag, l) => `Modified layout of ${cnt} ${tag} element(s) on layer ${l}.`,
    color: '#ffff00'
  }
};

function formatTrackChain(group) {
  const netLabel = group.net && group.net.trim() ? group.net.trim() : null;
  const segInfo = group.segmentCount ? ` (${group.segmentCount} segs)` : '';
  return {
    title: netLabel ? `${netLabel} re-routed${segInfo}` : `Trace re-routed${segInfo}`,
    desc: `Adjusted track chain on layer ${group.layerName}.`
  };
}

function resolveNamedItem(group, vocab) {
  if (group.component && group.component !== 'Component') {
    return {
      title: group.label || `${vocab.verb} ${group.id}`,
      desc: vocab.componentDesc(group.component, group.layerName)
    };
  }
  if (group.id && group.count === 1) {
    return {
      title: `${vocab.verb} ${group.id}`,
      desc: vocab.shapeDesc(group.tag, group.layerName)
    };
  }
  return null;
}

function resolveCopperItem(group, vocab) {
  const isCopper = Boolean(group.layerName && (group.layerName.endsWith('.Cu') || group.layerName.includes('_Cu')));
  if (!isCopper) return null;

  const countStr = group.count > 1 ? ` (${group.count}x)` : '';
  const isPlural = group.count > 1;

  if (['path', 'line', 'polyline'].includes(group.tag)) {
    return {
      title: vocab.trackTitle(isPlural, countStr),
      desc: vocab.trackDesc(group.layerName)
    };
  }
  if (['circle', 'ellipse', 'rect'].includes(group.tag)) {
    return {
      title: vocab.viaTitle(isPlural, countStr),
      desc: vocab.viaDesc(group.layerName)
    };
  }
  return null;
}

function resolveStandardItemDetails(group, vocab) {
  const named = resolveNamedItem(group, vocab);
  if (named) return named;

  const copper = resolveCopperItem(group, vocab);
  if (copper) return copper;

  const countStr = group.count > 1 ? ` (${group.count}x)` : '';
  return {
    title: `${vocab.verb} ${group.tag.toUpperCase()}s${countStr}`,
    desc: vocab.defaultDesc(group.count, group.tag, group.layerName)
  };
}

function resolveLayerDetails(group) {
  if (group.type === 'add_layer') {
    return {
      details: { title: 'Added Layer', desc: `Entire layer file ${group.id} was added.` },
      color: '#00ff66'
    };
  }
  if (group.type === 'delete_layer') {
    return {
      details: { title: 'Removed Layer', desc: `Entire layer file ${group.id} was removed.` },
      color: '#ff3366'
    };
  }
  return null;
}

function buildLogEntry(group, details, color) {
  let desc = details.desc;
  if (group.texts && group.texts.length > 0) {
    desc += ` Text: "${group.texts.join(', ')}".`;
  }

  return {
    title: details.title,
    desc,
    time: group.layerName,
    type: group.type,
    color,
    tag: group.tag,
    diffIdx: group.diffIdx,
    side: group.side,
    rawType: group.type,
    baseCoords: group.baseCoords,
    targetCoords: group.targetCoords,
  };
}

function formatLogItem(group) {
  if (group.class === 'track_chain' && group.type === 'modify') {
    return buildLogEntry(group, formatTrackChain(group), '#ffff00');
  }
  const layerResult = resolveLayerDetails(group);
  if (layerResult) {
    return buildLogEntry(group, layerResult.details, layerResult.color);
  }
  const vocab = ACTION_VOCAB[group.type] || ACTION_VOCAB.modify;
  const details = resolveStandardItemDetails(group, vocab);
  return buildLogEntry(group, details, vocab.color);
}

export function getAuditLogs(diffData) {
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

  const groups = groupModifications(diffData.modifications);
  return groups.map(formatLogItem).sort((a, b) => getPriority(b) - getPriority(a));
}

function resolveActionFromRawType(rawType) {
  if (rawType === 'add' || rawType === 'add_layer') return 'ADDED';
  if (rawType === 'delete' || rawType === 'delete_layer') return 'DELETED';
  return 'CHANGED';
}

function mapLogToSidebarMod(log) {
  return {
    action: resolveActionFromRawType(log.rawType),
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
}

export function buildSidebarModifications(diffData) {
  if (diffData?.modifications && diffData.modifications.length > 0) {
    return diffData.modifications;
  }
  const logs = getAuditLogs(diffData);
  if (!logs || logs.length === 0 || logs[0].type === 'info') return [];

  return logs.map(mapLogToSidebarMod);
}

function matchesIdentifier(m, i, modId) {
  return m.id === modId ||
    String(m.diffIdx) === String(modId) ||
    modId === `mod-${i}` ||
    modId === `mod-${m.diffIdx}`;
}

function matchesLabel(m, label) {
  if (!label) return false;
  return Boolean(m.name?.includes(label) || m.title?.includes(label) || m.net?.includes(label));
}

export function findCopilotModIndex(mods, modId, label) {
  if (!mods || mods.length === 0) return -1;
  return mods.findIndex((m, i) => {
    if (matchesIdentifier(m, i, modId)) return true;
    if (m.refDes && (m.refDes === modId || m.refDes === label)) return true;
    return matchesLabel(m, label);
  });
}
