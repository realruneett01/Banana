import React from 'react';

/**
 * Normalizes backslashes to forward slashes and matches the filename
 * against the selected active layers checklist.
 */
const isLayerActive = (filename, activeLayers) => {
  const name = filename.toLowerCase();

  // If it's a schematic export (usually single SVG like "analogins.svg"),
  // show it regardless of PCB layer filters.
  if (
    !name.includes('_cu') &&
    !name.includes('silkscreen') &&
    !name.includes('edge_cuts') &&
    !name.includes('silks') &&
    !name.includes('mask') &&
    !name.includes('paste')
  ) {
    return true;
  }

  return activeLayers.some((layer) => {
    const normalizedLayer = layer.replace('.', '_').toLowerCase();

    // Special mappings for silkscreen layers
    if (normalizedLayer === 'f_silks') {
      return name.includes('f_silkscreen') || name.includes('f_silks');
    }
    if (normalizedLayer === 'b_silks') {
      return name.includes('b_silkscreen') || name.includes('b_silks');
    }

    return name.includes(normalizedLayer);
  });
};

/**
 * Checks if a specific SVG filename matches the currently soloed layer.
 */
const isLayerSolo = (filename, soloLayer) => {
  if (!soloLayer) return true;
  const name = filename.toLowerCase();
  const normalizedLayer = soloLayer.replace('.', '_').toLowerCase();

  if (normalizedLayer === 'f_silks') {
    return name.includes('f_silkscreen') || name.includes('f_silks');
  }
  if (normalizedLayer === 'b_silks') {
    return name.includes('b_silkscreen') || name.includes('b_silks');
  }

  return name.includes(normalizedLayer);
};

// Helper to match layer filename and return configured opacity (0-1)
const getLayerOpacity = (filename, layerOpacities) => {
  if (!layerOpacities || Object.keys(layerOpacities).length === 0) return 1;
  const name = filename.toLowerCase();
  for (const [layerValue, opacity] of Object.entries(layerOpacities)) {
    const nl = layerValue.replace('.', '_').toLowerCase();
    if (nl === 'f_silks') {
      if (name.includes('f_silkscreen') || name.includes('f_silks')) return opacity;
    } else if (nl === 'b_silks') {
      if (name.includes('b_silkscreen') || name.includes('b_silks')) return opacity;
    } else if (name.includes(nl)) {
      return opacity;
    }
  }
  return 1;
};

const SvgLayer = React.memo(({ filename, content, isBase, filterStyle, opacityStyle, mixBlendMode }) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        filter: filterStyle,
        opacity: opacityStyle,
        mixBlendMode,
        transition: 'filter 0.25s ease, opacity 0.25s ease',
        pointerEvents: 'none',
        transform: 'translate3d(0px, 0px, 0px)',
        willChange: 'transform, opacity, filter',
        backfaceVisibility: 'hidden',
      }}
      dangerouslySetInnerHTML={{
        __html: content.replace(/<svg/, '<svg style="width:100%; height:100%; position:absolute;"')
      }}
    />
  );
}, (prev, next) => {
  return prev.content === next.content &&
         prev.filterStyle === next.filterStyle &&
         prev.opacityStyle === next.opacityStyle &&
         prev.mixBlendMode === next.mixBlendMode;
});

export default function DiffCanvas({ baseSvgs, targetSvgs, diffMode, activeLayers, sliderValue, soloLayer, layerOpacities }) {
  // Filter base and target svgs based on active layers
  const activeBaseSvgs = (baseSvgs || []).filter((svg) => isLayerActive(svg.filename, activeLayers));
  const activeTargetSvgs = (targetSvgs || []).filter((svg) => isLayerActive(svg.filename, activeLayers));

  const isSlider = diffMode === 'Overlay Slider';

  // CSS filter to turn SVGs pure red:
  const redFilter = 'invert(24%) sepia(93%) saturate(7355%) hue-rotate(356deg) brightness(94%) contrast(119%)';
  // CSS filter to turn SVGs pure green:
  const greenFilter = 'invert(57%) sepia(74%) saturate(2256%) hue-rotate(84deg) brightness(119%) contrast(118%)';

  const renderSvgElement = (svg, isBase) => {
    const isSolo = !soloLayer || isLayerSolo(svg.filename, soloLayer);
    const layerOp = getLayerOpacity(svg.filename, layerOpacities);

    // Set filter style
    let filterStyle = 'none';
    if (!isSlider) {
      filterStyle = isBase ? redFilter : greenFilter;
    }

    // Apply grey-out if another layer is soloed
    if (soloLayer && !isSolo) {
      filterStyle = 'grayscale(1) opacity(0.12) contrast(0.5) brightness(0.6)';
    }

    const elementOpacity = (soloLayer && !isSolo) ? 0.12 : layerOp;
    const blendMode = (isSlider || (soloLayer && !isSolo)) ? 'normal' : 'difference';

    return (
      <SvgLayer
        key={`${isBase ? 'base' : 'target'}-${svg.filename}`}
        filename={svg.filename}
        content={svg.content}
        isBase={isBase}
        filterStyle={filterStyle}
        opacityStyle={elementOpacity}
        mixBlendMode={blendMode}
      />
    );
  };

  // Base container styles
  const baseContainerStyle = {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  };

  // Target container styles
  const targetContainerStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    clipPath: isSlider ? `inset(0 0 0 ${sliderValue}%)` : 'none',
    pointerEvents: 'none',
    transform: 'translate3d(0px, 0px, 0px)',
    willChange: 'transform, clip-path',
    backfaceVisibility: 'hidden',
  };

  // Shared inner SVG element container styles
  const svgWrapperStyle = {
    width: '100%',
    height: '100%',
    position: 'relative',
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '400px',
        overflow: 'hidden',
        background: '#1b1d28',
        borderRadius: '6px',
        border: '1px solid #232738',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div style={{ width: '95%', height: '95%', position: 'relative' }}>
        {/* Base Layer */}
        <div style={baseContainerStyle}>
          <div style={svgWrapperStyle}>
            {activeBaseSvgs.map((svg) => renderSvgElement(svg, true))}
          </div>
        </div>

        {/* Target Layer */}
        <div style={targetContainerStyle}>
          <div style={svgWrapperStyle}>
            {activeTargetSvgs.map((svg) => renderSvgElement(svg, false))}
          </div>
        </div>

        {/* Slider split-line visual guide */}
        {isSlider && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${sliderValue}%`,
              width: '2px',
              backgroundColor: '#fadb14',
              boxShadow: '0 0 8px rgba(250, 219, 20, 0.8)',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          />
        )}
      </div>
    </div>
  );
}
