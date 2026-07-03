/*
 Copyright (c) 2023 Alethea Katherine Flowers.
 Published under the standard MIT License.
 Full text available at: https://opensource.org/licenses/MIT
*/

import { type Theme } from "../../kicad";
import witch_hazel from "./witch-hazel";
import kicad_default from "./kicad-default";
import custom_kicad from "./custom-kicad";

const themes = [witch_hazel, kicad_default, custom_kicad];
const themes_by_name = new Map(
    themes.map((v) => {
        return [v.name, v];
    }),
);

export default {
    // kicad_default mirrors KiCad's real layer colors *and* alpha values
    // (solder mask/paste translucency, etc). custom_kicad is a debug
    // palette left over from development - it overrides colors with
    // fully-opaque neon values and drops the mask/paste transparency
    // entirely, which is what was flattening the board into a solid
    // cyan/green wash. Use kicad_default for a faithful clone.
    default: kicad_default,

    by_name(name: string): Theme {
        return themes_by_name.get(name) ?? this.default;
    },

    list(): Theme[] {
        return themes;
    },
};
