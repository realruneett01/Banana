/*
    Copyright (c) 2025 Xiang Yang.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { LocalFileSystem } from "../../kicanvas/services/vfs";

export class FilePicker {
    /**
     * Open a file picker (individual files only) and call callback with
     * the selected files.
     */
    static async pick(callback: (vfs: LocalFileSystem) => Promise<void>) {
        const files = await FilePicker.open_picker();
        if (files.length > 0) {
            await callback(new LocalFileSystem(files));
        }
    }

    /**
     * Open a folder picker and call callback with every kicad file found
     * in that folder (including subfolders), preserving their relative
     * paths so hierarchical sheets can be resolved.
     */
    static async pick_folder(
        callback: (vfs: LocalFileSystem) => Promise<void>,
    ) {
        const files = await FilePicker.open_folder_picker();
        if (files.length > 0) {
            await callback(new LocalFileSystem(files));
        }
    }

    /**
     * Open the file picker
     */
    private static open_picker(): Promise<File[]> {
        return new Promise((resolve) => {
            // because the Window:showOpenFilePicker() method is experimental
            // so we use the traditional technique
            const input = document.createElement("input");

            input.type = "file";
            input.style.display = "none";
            input.multiple = true;
            input.accept = ".kicad_pcb,.kicad_pro,.kicad_sch";

            input.onchange = (event) => {
                const files = (event.target as HTMLInputElement).files;
                if (files && files.length > 0) {
                    resolve(Array.from(files));
                } else {
                    resolve([]);
                }
            };

            input.oncancel = () => {
                resolve([]);
            };

            input.click();
        });
    }

    /**
     * Open a folder picker (webkitdirectory) so users can select an
     * entire local project folder instead of hand-picking individual
     * files one at a time.
     */
    private static open_folder_picker(): Promise<File[]> {
        return new Promise((resolve) => {
            const input = document.createElement("input");

            input.type = "file";
            input.style.display = "none";
            input.multiple = true;
            // webkitdirectory is non-standard but broadly supported
            // (Chrome, Edge, Firefox, Safari) for picking a whole folder.
            input.setAttribute("webkitdirectory", "");
            input.setAttribute("directory", "");

            input.onchange = (event) => {
                const files = (event.target as HTMLInputElement).files;
                if (files && files.length > 0) {
                    resolve(Array.from(files));
                } else {
                    resolve([]);
                }
            };

            input.oncancel = () => {
                resolve([]);
            };

            input.click();
        });
    }
}
