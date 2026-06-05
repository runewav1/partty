/**
 * Combined icon mappings for file tree.
 * Imports from category-specific mapping files.
 */

import { LANGUAGE_EXTENSIONS } from "./languages";
import { CONFIG_DATA_EXTENSIONS } from "./configData";
import { MEDIA_ARCHIVE_EXTENSIONS } from "./mediaArchive";
import { SPECIAL_FILENAMES } from "./specialFiles";
import { FOLDER_NAMES } from "./folderNames";

/**
 * Combined extension to icon mapping.
 */
export const EXTENSION_TO_ICON: Map<string, string> = new Map([
  ...LANGUAGE_EXTENSIONS,
  ...CONFIG_DATA_EXTENSIONS,
  ...MEDIA_ARCHIVE_EXTENSIONS,
]);

/**
 * Special filename to icon mapping.
 */
export const FILENAME_TO_ICON: Map<string, string> = new Map(SPECIAL_FILENAMES);

/**
 * Folder name to icon mapping.
 */
export const FOLDER_NAME_TO_ICON: Map<string, string> = new Map(FOLDER_NAMES);
