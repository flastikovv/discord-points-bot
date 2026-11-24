// Вставляет иконку и сведения о версии в MonetizationStudio.exe (без wine)
const fs = require('fs');
const path = require('path');
const ResEdit = require('resedit');
const png2icons = require('png2icons');

const root = path.join(__dirname, '..');
const exe = path.join(root, 'dist', 'win-unpacked', 'MonetizationStudio.exe');
const ico = png2icons.createICO(fs.readFileSync(path.join(root, 'assets', 'icon.png')), png2icons.BICUBIC, 0, false, true);
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico);

const data = ResEdit.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(data);
const iconFile = ResEdit.Data.IconFile.from(ico);
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const groupId = groups.length ? groups[0].id : 1;
const lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
if (vi) {
  const version = require('../package.json').version;
  const [a, b, c] = version.split('.').map(Number);
  vi.setFileVersion(a, b, c, 0, 1033);
  vi.setProductVersion(a, b, c, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'Студия Монетизации', ProductName: 'Студия Монетизации', CompanyName: 'Студия Монетизации',
    OriginalFilename: 'MonetizationStudio.exe', InternalName: 'MonetizationStudio', LegalCopyright: '',
  });
  vi.outputToResourceEntries(res.entries);
}
res.outputResource(data);
fs.writeFileSync(exe, Buffer.from(data.generate()));
console.log('patched', exe);
