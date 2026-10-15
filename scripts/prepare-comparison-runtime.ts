import {resolve} from 'node:path';
import {CreativeRuntime} from '../plugins/cocode-director/creative-runtime.js';
import {CreativeWorkspace} from '../plugins/cocode-director/workspace.js';
import {readConfig} from '../shared/config.js';
await new CreativeRuntime(readConfig(),new CreativeWorkspace(resolve(process.argv[2])),new AbortController().signal).prepareLibraries();
console.log('Local rendering libraries ready');
