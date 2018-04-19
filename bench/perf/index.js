'use strict';

const { join } = require('path');
const { readFileSync, createReadStream, readdirSync } = require('fs');
const Benchmark = require('benchmark');
const testUtils = require('../../test/test_utils');

//HACK: https://github.com/bestiejs/benchmark.js/issues/51
/* global workingCopy, upstreamParser, hugePage, microTests, runMicro, runPages, files */
global.workingCopy = require('../../lib');
global.upstreamParser = require('parse5');

// Huge page data
global.hugePage = readFileSync(join(__dirname, '../../test/data/huge-page/huge-page.html')).toString();

// Micro data
global.microTests = testUtils
    .loadTreeConstructionTestData(
        [join(__dirname, '../../test/data/html5lib-tests/tree-construction')],
        workingCopy.treeAdapters.default
    )
    .filter(
        test =>
            //NOTE: this test caused stack overflow in parse5 v1.x
            test.input !== '<button><p><button>'
    )
    .map(test => ({
        html: test.input,
        fragmentContext: test.fragmentContext
    }));

global.runMicro = function(parser) {
    for (const test of microTests) {
        if (test.fragmentContext) {
            parser.parseFragment(test.fragmentContext, test.html);
        } else {
            parser.parse(test.html);
        }
    }
};

// Pages data
const pages = testUtils.loadSAXParserTestData().map(test => test.src);

global.runPages = function(parser) {
    for (let j = 0; j < pages.length; j++) {
        parser.parse(pages[j]);
    }
};

// Stream data
global.files = readdirSync(join(__dirname, '../../test/data/sax')).map(dirName =>
    join(__dirname, '../../test/data/sax', dirName, 'src.html')
);

// Utils
function getHz(suite, testName) {
    return suite.filter(t => t.name === testName)[0].hz;
}

function runBench({ name, workingCopyFn, upstreamFn, defer = false }) {
    const suite = new Benchmark.Suite(name);

    suite
        .add('Working copy', workingCopyFn, { defer })
        .add('Upstream', upstreamFn, { defer })
        .on('start', () => console.log(name))
        .on('cycle', event => console.log(String(event.target)))
        .on('complete', () => {
            const workingCopyHz = getHz(suite, 'Working copy');
            const upstreamHz = getHz(suite, 'Upstream');

            if (workingCopyHz > upstreamHz) {
                console.log(`Working copy is ${(workingCopyHz / upstreamHz).toFixed(2)}x faster.\n`);
            } else {
                console.log(`Working copy is ${(upstreamHz / workingCopyHz).toFixed(2)}x slower.\n`);
            }
        })
        .run();
}

// Benchmarks
runBench({
    name: 'parse5 regression benchmark - MICRO',
    workingCopyFn: () => runMicro(workingCopy),
    upstreamFn: () => runMicro(upstreamParser)
});

runBench({
    name: 'parse5 regression benchmark - HUGE',
    workingCopyFn: () => workingCopy.parse(hugePage),
    upstreamFn: () => upstreamParser.parse(hugePage)
});

runBench({
    name: 'parse5 regression benchmark - PAGES',
    workingCopyFn: () => runPages(workingCopy),
    upstreamFn: () => runPages(upstreamParser)
});

runBench({
    name: 'parse5 regression benchmark - STREAM',
    defer: true,
    workingCopyFn: async deferred => {
        const parsePromises = files.map(
            fileName =>
                new Promise(resolve => {
                    const stream = createReadStream(fileName);
                    const parserStream = new workingCopy.ParserStream();

                    stream.pipe(parserStream);
                    parserStream.on('finish', resolve);
                })
        );

        await Promise.all(parsePromises);
        deferred.resolve();
    },
    upstreamFn: async deferred => {
        const parsePromises = files.map(
            fileName =>
                new Promise(resolve => {
                    const stream = createReadStream(fileName);
                    let data = '';

                    stream.on('data', chunk => (data += chunk.toString('utf8')));

                    stream.on('end', () => {
                        upstreamParser.parse(data);
                        resolve();
                    });
                })
        );

        await Promise.all(parsePromises);
        deferred.resolve();
    }
});
