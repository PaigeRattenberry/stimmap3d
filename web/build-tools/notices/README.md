# Supplemental package notices

These published npm tarballs omit their own root notice. Exact-version upstream copies were retrieved 2026-09-15:

- `victory-vendor-36.9.2.txt`: https://raw.githubusercontent.com/FormidableLabs/victory/v36.9.2/LICENSE.txt
- `react-three-fiber-9.6.1.txt`: https://raw.githubusercontent.com/pmndrs/react-three-fiber/v9.6.1/LICENSE
- `react-three-fiber-9.7.0.txt`: https://raw.githubusercontent.com/pmndrs/react-three-fiber/v9.7.0/LICENSE (byte-identical to the 9.6.1 copy; the 9.7.0 tarball still ships no license file)

The build includes them only for those exact package versions and separately collects notices beside bundled vendor modules. A version change with a missing notice fails the build so the replacement can be reviewed. These files are third-party notices, not the license for StimMap3D's original code.
