// Minimal ZIP writer (deflate), so releases need no external zip tool on any OS.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

export function crc32(buf) {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function walk(dir, base = dir) {
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.sort((a, b) => (a.name < b.name ? -1 : 1))
		.flatMap((e) => {
			const full = path.join(dir, e.name);
			// node_modules/.bin holds symlinks that are useless in a bundle (and break on FAT/Windows).
			if (e.name === ".bin") return [];
			const isDir = e.isDirectory() || (e.isSymbolicLink() && fs.statSync(full).isDirectory());
			return isDir ? walk(full, base) : [path.relative(base, full).split(path.sep).join("/")];
		});
}

/**
 * Zips a directory under a top-level folder name. Timestamps are fixed so identical input gives an
 * identical archive; files named start.sh / ending .sh keep their executable bit for Unix unzip.
 */
export function zipDirectory(srcDir, outFile, topFolder) {
	const DOS_TIME = 0;
	const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
	const chunks = [];
	const central = [];
	let offset = 0;
	const push = (b) => {
		chunks.push(b);
		offset += b.length;
	};

	for (const rel of walk(srcDir)) {
		const data = fs.readFileSync(path.join(srcDir, rel));
		const name = Buffer.from(`${topFolder}/${rel}`, "utf8");
		const comp = zlib.deflateRawSync(data, { level: 9 });
		const useDeflate = comp.length < data.length;
		const body = useDeflate ? comp : data;
		const crc = crc32(data);
		const exec = rel.endsWith(".sh");

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6); // UTF-8 names
		local.writeUInt16LE(useDeflate ? 8 : 0, 8);
		local.writeUInt16LE(DOS_TIME, 10);
		local.writeUInt16LE(DOS_DATE, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);
		const localOffset = offset;
		push(local);
		push(name);
		push(body);

		const cd = Buffer.alloc(46);
		cd.writeUInt32LE(0x02014b50, 0);
		cd.writeUInt16LE((3 << 8) | 20, 4); // made by Unix
		cd.writeUInt16LE(20, 6);
		cd.writeUInt16LE(0x0800, 8);
		cd.writeUInt16LE(useDeflate ? 8 : 0, 10);
		cd.writeUInt16LE(DOS_TIME, 12);
		cd.writeUInt16LE(DOS_DATE, 14);
		cd.writeUInt32LE(crc, 16);
		cd.writeUInt32LE(body.length, 20);
		cd.writeUInt32LE(data.length, 24);
		cd.writeUInt16LE(name.length, 28);
		cd.writeUInt32LE(((exec ? 0o100755 : 0o100644) << 16) >>> 0, 38);
		cd.writeUInt32LE(localOffset, 42);
		central.push(Buffer.concat([cd, name]));
	}

	const cdStart = offset;
	for (const c of central) push(c);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(central.length, 8);
	end.writeUInt16LE(central.length, 10);
	end.writeUInt32LE(offset - cdStart, 12);
	end.writeUInt32LE(cdStart, 16);
	push(end);
	fs.writeFileSync(outFile, Buffer.concat(chunks));
	return central.length;
}
