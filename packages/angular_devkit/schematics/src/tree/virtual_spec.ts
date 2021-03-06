/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
// tslint:disable:non-null-operator no-big-function
import { normalize, virtualFs } from '@angular-devkit/core';
import { FileAlreadyExistException, FileDoesNotExistException } from '../exception/exception';
import { testTreeVisit } from './common_spec';
import { FileSystemTree } from './filesystem';
import { FileEntry, MergeStrategy, Tree } from './interface';
import { merge, partition } from './static';
import { VirtualTree } from './virtual';


function files(tree: Tree) {
  const treeFiles: string[] = [];
  tree.visit(x => treeFiles.push(x));

  return treeFiles;
}


describe('VirtualDirEntry', () => {
  testTreeVisit({
    createTree: paths => {
      const tree = new VirtualTree();
      paths.forEach(path => tree.create(path, path));

      return tree;
    },
    sets: [
      {
        name: 'empty',
        files: [],
        visits: [
          {root: '/', expected: []},
        ],
      },

      {
        name: 'file at root',
        files: ['/file'],
        visits: [
          {root: '/'},
          {root: '/file', expected: []},
        ],
      },
      {
        name: 'file under first level folder',
        // duplicate use case: folder of single file at root
        files: ['/folder/file'],
        visits: [
          {root: '/'},
          {root: '/folder', expected: ['/folder/file']},
          {root: '/folder/file', expected: []},
          {root: '/wrong', expected: []},
        ],
      },
      {
        name: 'file under nested folder',
        // duplicate use case: nested folder of files
        files: ['/folder/nested_folder/file'],
        visits: [
          {root: '/'},
          {root: '/folder', expected: ['/folder/nested_folder/file']},
          {root: '/folder/nested_folder', expected: ['/folder/nested_folder/file']},
          {root: '/folder/nested_folder/file', expected: []},
        ],
      },

      {
        name: 'nested folders',
        // duplicate use case: folder of folders at root
        // duplicate use case: folders of mixed
        files: [
          '/folder/nested_folder0/file',
          '/folder/nested_folder1/folder/file',
          '/folder/nested_folder2/file',
          '/folder/nested_folder2/folder/file',
        ],
        visits: [
          {root: '/'},
          {root: '/folder'},
          {root: '/folder/nested_folder0', expected: ['/folder/nested_folder0/file']},
          {root: '/folder/nested_folder1', expected: ['/folder/nested_folder1/folder/file']},
          {root: '/folder/nested_folder1/folder', expected: ['/folder/nested_folder1/folder/file']},
          {root: '/folder/nested_folder2', expected: [
            '/folder/nested_folder2/file',
            '/folder/nested_folder2/folder/file',
          ]},
          {root: '/folder/nested_folder2/folder', expected: ['/folder/nested_folder2/folder/file']},
        ],
      },
    ],
  });
});


describe('VirtualTree', () => {
  describe('exists()', () => {
    it('works', () => {
      const tree = new VirtualTree();
      tree.create('/some/file', 'some _content');
      expect(tree.exists('/some/file')).toBe(true);
      expect(tree.exists('/other/file')).toBe(false);
    });
  });
  describe('read()', () => {
    it('works', () => {
      const tree = new VirtualTree();
      tree.create('/some/file', 'some _content');
      expect(tree.read('/some/file') !.toString()).toBe('some _content');
      expect(tree.read('/other/file')).toBe(null);
    });
  });
  describe('files', () => {
    it('works', () => {
      const tree = new VirtualTree();
      tree.create('/some/file', 'some _content');
      tree.create('/some/other-file', 'some _content');
      tree.create('/some/other-file2', 'some _content');

      expect(files(tree)).toEqual([
        '/some/file', '/some/other-file', '/some/other-file2',
      ].map(normalize));
    });
  });

  describe('overwrite()', () => {
    it('works', () => {
      const tree = new VirtualTree();
      tree.create('/some/file', 'some content');
      tree.overwrite('/some/file', 'some other content');

      expect(tree.read('/some/file') !.toString()).toEqual('some other content');
    });
  });

  describe('insertContent()', () => {
    it('works', () => {
      const tree = new VirtualTree();
      tree.create('/some/file', 'some _content');
      const recorder = tree.beginUpdate('/some/file');
      recorder.insertLeft(4, ' hello');
      tree.commitUpdate(recorder);

      expect(tree.actions.length).toBe(2);
      expect(tree.read('/some/file') !.toString()).toBe('some hello _content');
    });

    it('throws when the file does not exist', () => {
      const tree = new VirtualTree();
      expect(() => tree.beginUpdate('/some/file'))
        .toThrow(new FileDoesNotExistException('/some/file'));
    });
  });

  describe('combinatorics', () => {
    it('works', () => {
      const tree = new VirtualTree();
      tree.create('file1', 'some _content');
      tree.create('file2', 'some _content');
      tree.create('file3', 'some _content');

      const [tree1, tree2] = partition(tree, p => p == '/file1');
      expect(tree1.exists('file1')).toBe(true);
      expect(tree1.exists('file2')).toBe(false);
      expect(tree1.exists('file3')).toBe(false);

      expect(tree2.exists('file1')).toBe(false);
      expect(tree2.exists('file2')).toBe(true);
      expect(tree2.exists('file3')).toBe(true);

      const tree3 = merge(tree1, tree2, MergeStrategy.Error);
      expect(files(tree3).sort()).toEqual(files(tree).sort());
    });
  });

  describe('optimize', () => {
    it('works', () => {
      const host = new virtualFs.test.TestHost({
        '/hello': 'world',
      });
      const tree = new FileSystemTree(host);

      tree.create('/created', 'test 1');
      tree.create('/hello1', 'test 2');
      tree.overwrite('/hello1', 'beautiful world');
      tree.overwrite('/hello', 'beautiful world');

      expect(tree.actions.length).toBe(4);
      tree.optimize();
      expect(tree.actions.length).toBe(3);
    });

    it('works with branching', () => {
      const host = new virtualFs.test.TestHost({
        '/hello': '',
        '/sub/file1': '',
        '/sub/directory/file2': '',
      });
      const tree = new FileSystemTree(host);

      tree.create('/test', 'testing 1 2');
      const recorder = tree.beginUpdate('/test');
      recorder.insertLeft(8, 'testing ');
      tree.commitUpdate(recorder);
      tree.overwrite('/hello', 'world');
      tree.overwrite('/test', 'test 3');

      const expected = ['/hello', '/sub/directory/file2', '/sub/file1', '/test'];
      expect(files(tree).sort()).toEqual(expected.map(normalize));

      const tree2 = tree.branch() as VirtualTree;
      expect(tree.actions.length).toBe(4);
      expect(tree2.actions.length).toBe(4);

      tree2.optimize();
      expect(tree.actions.length).toBe(4);
      expect(tree2.actions.length).toBe(2);
    });
  });

  describe('rename', () => {
    it('conflict fails', () => {
      const host = new virtualFs.test.TestHost({
        '/hello': 'world',
      });
      const tree = new FileSystemTree(host);
      tree.create('/base', 'base content');
      const tree2 = new FileSystemTree(host);
      tree2.create('/other-base', 'base content');
      tree2.rename('/other-base', '/base');

      expect(() => tree.merge(tree2))
        .toThrow(new FileAlreadyExistException('/base'));
    });

    it('conflict works with overwrite', () => {
      const host = new virtualFs.test.TestHost({
        '/hello': 'world',
      });
      const tree = new FileSystemTree(host);

      const tree2 = new FileSystemTree(host);
      const newContent = 'new content';
      tree2.create('/greetings', newContent);
      tree2.rename('/greetings', '/hello');

      tree.merge(tree2, MergeStrategy.Overwrite);
      const fileEntry = tree.get('/hello');
      expect((fileEntry as FileEntry).content.toString()).toEqual(newContent);
    });

    it('can rename files in base', () => {
      const host = new virtualFs.test.TestHost({
        '/hello': 'world',
      });
      const tree = new FileSystemTree(host);

      tree.rename('/hello', '/world');

      const fileEntry = tree.get('/hello');
      const fileEntry2 = tree.get('/world');
      expect((fileEntry as FileEntry).content.toString())
        .toEqual((fileEntry2 as FileEntry).content.toString());
    });

    it('can rename files created in staging', () => {
      const host = new virtualFs.test.TestHost({
      });
      const tree = new FileSystemTree(host);

      tree.create('/hello', 'world');
      tree.rename('/hello', '/hello2');

      expect(tree.exists('/hello')).toBe(false);
      const fileEntry = tree.get('/hello2');
      expect((fileEntry as FileEntry).content.toString())
        .toEqual('world');
    });

    it('can rename branched and merged trees', () => {
      const host = new virtualFs.test.TestHost({
        '/hello': 'world',
      });
      const tree = new FileSystemTree(host);
      const tree2 = tree.branch();

      expect(tree2.exists('/hello')).toBe(true);
      tree2.rename('/hello', '/hello2');
      expect(tree2.exists('/hello2')).toBe(true);

      tree.merge(tree2);
      expect(tree.exists('/hello2')).toBe(true);
      const fileEntry = tree.get('/hello2');
      expect((fileEntry as FileEntry).content.toString())
        .toEqual('world');
    });
  });
});
