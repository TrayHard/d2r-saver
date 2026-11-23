"""Copy the rows of a Blizzless mod's excel tables onto this library's column layout.

The parsers in src/data-parser read columns by position, and the game's tables gain and
rename columns between versions. This keeps every column of data/txt/<table>.txt, fills
each from the mod column of the same name, and maps uniqueitems `enabled` from the
mod's `disabled`. Rows keep the mod's order, so the unique and set ids follow the game.

usage: python -I scripts/project-mod-tables.py <mod>/data/global/excel table...
then:  npm run build:data
"""
import os
import sys

TXT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'txt')


def find(folder, name):
    return next((os.path.join(folder, f) for f in os.listdir(folder) if f.lower() == name.lower()), None)


def read(path):
    raw = open(path, encoding='utf-8', newline='').read()
    eol = '\r\n' if '\r\n' in raw else '\n'
    lines = raw.split(eol)
    return [line.split('\t') for line in (lines[:-1] if lines[-1] == '' else lines)], eol


def main(mod, tables):
    for table in tables:
        own_path, mod_path = find(TXT, table + '.txt'), find(mod, table + '.txt')
        if not own_path or not mod_path:
            sys.exit(f'{table}: missing in data/txt or in the mod')
        own, eol = read(own_path)
        rows, _ = read(mod_path)
        columns = {name: i for i, name in enumerate(rows[0])}
        out = [own[0]]
        for row in rows[1:]:
            get = lambda name: row[columns[name]] if columns.get(name, len(row)) < len(row) else ''
            line = []
            for name in own[0]:
                if name in columns:
                    line.append(get(name))
                elif table == 'uniqueitems' and name == 'enabled':
                    line.append('' if get('disabled') == '1' or get('index') == '' else '1')
                else:
                    line.append('')
            out.append(line)
        with open(own_path, 'w', encoding='utf-8', newline='') as f:
            f.write(eol.join('\t'.join(line) for line in out) + eol)
        missing = [name for name in own[0] if name not in columns]
        print(f'{table}: {len(own) - 1} -> {len(out) - 1} rows; columns not in the mod: {missing}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
