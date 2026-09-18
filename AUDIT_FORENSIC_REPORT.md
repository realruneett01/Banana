# Banana 2.0 — Audit Modification Data Pipeline Forensic Report

## 1. Frontend Audit Sidebar Component Location
- **Render File & Line**: [`frontend/src/App.jsx:1128-1182`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/frontend/src/App.jsx#L1128-L1182)
- **Active Component in DOM**: [`AuditSidebar.jsx`](file:///c:/Users/realr/OneDrive/Desktop/Banana2.0/frontend/src/AuditSidebar.jsx) (rendered inside the right `Sider` of `App.jsx`).
- **JSX Expression Used in Component**:
  ```jsx
  {/* Header: Action Badge & Layer */}
  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${badgeClass}`}>
    {item.action}
  </span>

  {/* Primary Semantic Phrase */}
  <div className="text-xs font-semibold text-slate-100 capitalize">
    {item.title || `${item.action.toLowerCase()} ${item.name}`}
  </div>

  {/* Connection / Displacement Context */}
  {item.detail && (
    <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">
      {item.detail}
    </div>
  )}
  ```

---

## 2. API Response Payload Inspection
- **Actual JSON returned by backend `/api/diff/process` for `modifications` (on `BE007V1AS1.kicad_pcb` commit `34b1983` -> `298956d`)**:
  ```json
  [
    {
      "diffIdx": 0,
      "action": "CHANGED",
      "title": "changed unnamed trace",
      "type": "TRACE",
      "detail": "Layer F.Cu",
      "layer": "F.Cu",
      "bbox": {
        "x1": 157.55,
        "y1": 86.63,
        "x2": 160.38,
        "y2": 90.295
      },
      "side": "target",
      "baseCoords": {
        "x": 158.965,
        "y": 88.4625
      },
      "targetCoords": {
        "x": 158.965,
        "y": 88.4625
      }
    }
  ]
  ```

---

## 3. Backend S-Expression Extraction Status
- **Was `kicad-pcb-parser.js` executed?**: **Yes**. `parseKiCadBoard(targetPath)` ran successfully.
- **`pcbMetadata` received by `processSvgDiff`**: **Partial/Misconfigured Object**.
  - `footprints`: 126 footprints parsed.
  - `pads`: 250+ pads parsed.
  - `segments`: Attempted regex extractor `parsePcbMetadata` returned `0` segments because KiCad 8/9/10 formats `(segment ...)` and `(net "NAME")` across multiple lines without matching single-line regexes. However, `parseKiCadBoard`'s native AST parser already extracted all **1113 tracks**.
- **Net ID mapping / Track Sample from `BE007V1AS1.kicad_pcb`**:
  ```javascript
  {
    start: { x: 160.295, y: 90.295 },
    end: { x: 157.557997, y: 87.557997 },
    width: 0.25,
    layer: 'F.Cu',
    net: 'SPI2_CS',
    uuid: '06f51b28-941d-4e27-a09d-633de15df22d'
  }
  ```
- **Parsed segments count**: **1,113 track segments** in target PCB (45 belonging to SPI2 nets).

---

## 4. Root Disconnect Analysis

The UI renders `"CHANGED"` (badge) and `"Changed"` (body text) due to **three distinct disconnects** across the pipeline:

### Disconnect A: Frontend Payload Interception in `App.jsx`
1. The backend produces structured modifications with `{ action, title, name, type, detail, layer, ... }`.
2. In `frontend/src/App.jsx:1130`, instead of passing `diffData.modifications` directly to `<AuditSidebar>`, it passes the result of `getAuditLogs()`:
   ```jsx
   <AuditSidebar
     modifications={(() => {
       const logs = getAuditLogs(); // Legacy client-side heuristic grouping
       ...
       return logs.map((log) => ({
         action,
         layer: log.time,
         name: log.title,
         detail: log.desc,
         // NOTE: 'title' is NOT passed here!
       }));
     })()}
   />
   ```
3. In `getAuditLogs()` (lines 469-540), it checks `group.type === 'add' | 'delete' | 'modify'`, but the backend sends semantic types (`'TRACE'`, `'COMPONENT'`). All checks fail, leaving `log.title = ''` and `log.desc = ''`.
4. As a result, `<AuditSidebar>` receives `{ action: 'CHANGED', name: '', detail: '' }` with `item.title = undefined`.
5. `AuditSidebar.jsx:202` evaluates `{item.title || `${item.action.toLowerCase()} ${item.name}`}`, producing `'changed '`. With Tailwind CSS `capitalize`, it renders as **`"Changed"`**.

---

### Disconnect B: Backend Net Property Key Mismatch in `svg-diff-processor.js`
1. When `resolveSemanticIdentity()` finds a coordinate match in `pcbMetadata.segments`, it attempts to read `hit.netName`:
   ```javascript
   // svg-diff-processor.js:749
   return {
     name: hit.netName, // undefined!
     connection,
     type: 'TRACE',
     layer: hit.layer || diffItem.layer || 'F.Cu'
   };
   ```
2. The AST parser in `kicad-pcb-parser.js` stores the net name on `track.net` (not `track.netName`).
3. Because `hit.netName` is `undefined`, `cleanNetName(undefined)` returns `'unnamed'`, causing the backend to generate `"changed unnamed trace"`.

---

### Disconnect C: Multi-line S-Expression Regex Failure in `parsePcbMetadata`
1. `server.js` was relying on `parsePcbMetadata(pcbContent)` to populate `pcbMetadata.segments`.
2. The regex in `parsePcbMetadata` lacked multi-line (`s`) flags and expected integer net IDs `(net <id>)` rather than modern KiCad 8/9/10 string syntax `(net "SPI2_CS")`, yielding `0` segments.
3. The AST parser `board.tracks` already contains the full, accurate list of 1,113 tracks with resolved net names.
