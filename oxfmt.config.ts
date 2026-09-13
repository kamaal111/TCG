import kamaalOxfmtStyle from '@kamaal111/kamaal-quality-config/oxfmt';
import { defineConfig } from 'oxfmt';

export default defineConfig({
  ...kamaalOxfmtStyle,
  ignorePatterns: ['app', '.agents'],
});
