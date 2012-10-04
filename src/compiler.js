
var lib = require('./lib');
var parser = require('./parser');
var nodes = require('./nodes');
var Object = require('./object');
var Frame = require('./runtime').Frame;

// These are all the same for now, but shouldn't be passed straight
// through
var compareOps = {
    '==': '==',
    '!=': '!=',
    '<': '<',
    '>': '>',
    '<=': '<=',
    '>=': '>='
};

// A common pattern is to emit binary operators
function binOpEmitter(str) {
    return function(node, frame) {
        this.compile(node.left, frame);
        this.emit(str);
        this.compile(node.right, frame);
    };
}

var Compiler = Object.extend({
    init: function() {
        this.codebuf = [];
        this.lastId = 0;
        this.buffer = null;
        this.isChild = false;
    },

    emit: function(code) {
        this.codebuf.push(code);
    },

    emitLine: function(code) {
        this.emit(code + "\n");
    },

    emitFuncBegin: function(name) {
        this.buffer = 'output';
        this.emitLine('function ' + name + '(env, context, frame, runtime) {');
        this.emitLine('var ' + this.buffer + ' = "";');
    },

    emitFuncEnd: function(noReturn) {
        if(!noReturn) {
            this.emitLine('return ' + this.buffer + ';');
        }

        this.emitLine('}');
        this.buffer = null;
    },

    tmpid: function() {
        this.lastId++;
        return 't_' + this.lastId;
    },

    _compileChildren: function(node, frame) {
        var _this = this;
        node.iterChildren(function(n) {
            _this.compile(n, frame);
        });
    },

    _compileAggregate: function(node, frame, startChar, endChar) {
        this.emit(startChar);

        for(var i=0; i<node.children.length; i++) {
            if(i > 0) {
                this.emit(',');
            }

            this.compile(node.children[i], frame);
        }

        this.emit(endChar);
    },

    _compileExpression: function(node, frame) {
        this.assertType(node,
                        nodes.Literal,
                        nodes.Symbol,
                        nodes.Group,
                        nodes.Array,
                        nodes.Dict,
                        nodes.FunCall,
                        nodes.Filter,
                        nodes.LookupVal,
                        nodes.Compare,
                        nodes.And,
                        nodes.Or,
                        nodes.Not);
        this.compile(node, frame);
    },

    assertType: function(node /*, types */) {
        var types = lib.toArray(arguments).slice(1);
        var success = false;

        for(var i=0; i<types.length; i++) {
            if(node instanceof types[i]) {
                success = true;
            }
        };

        if(!success) {
            throw new Error("invalid type: " + node.typename);
        }
    },

    compileNodeList: function(node, frame) {
        this._compileChildren(node, frame);
    },

    compileLiteral: function(node, frame) {
        if(typeof node.value == "string") {
            var val = node.value.replace(/"/g, '\\"');
            val = val.replace(/\n/g, "\\n");
            val = val.replace(/\r/g, "\\r");
            val = val.replace(/\t/g, "\\t");
            this.emit('"' + val  + '"');
        }
        else {
            this.emit(node.value.toString());
        }
    },

    compileSymbol: function(node, frame) {
        var name = node.value;
        var v;

        if((v = frame.lookup(name))) {
            this.emit(v);
        }
        else {
            this.emit('context.lookup("' + name + '") || ' +
                      'frame.lookup("' + name + '") || ' +
                      '""');
        }
    },

    compileGroup: function(node, frame) {
        this._compileAggregate(node, frame, '(', ')');
    },

    compileArray: function(node, frame) {
        this._compileAggregate(node, frame, '[', ']');
    },

    compileDict: function(node, frame) {
        this._compileAggregate(node, frame, '{', '}');
    },

    compilePair: function(node, frame) {
        var key = node.getKey();
        var val = node.getValue();

        if(key instanceof nodes.Symbol) {
            key = new nodes.Literal(key.lineno, key.colno, key.value);
        }
        else if(!(key instanceof nodes.Literal &&
                  typeof node.value == "string")) {
            throw new Error("Dict keys must be strings or names");
        }

        this.compile(key, frame);
        this.emit(': ');
        this._compileExpression(val, frame);
    },

    compileOr: binOpEmitter(' || '),
    compileAnd: binOpEmitter(' && '),
    compileAdd: binOpEmitter(' + '),
    compileSub: binOpEmitter(' - '),
    compileMul: binOpEmitter(' * '),
    compileDiv: binOpEmitter(' / '),
    compileMod: binOpEmitter(' % '),

    compileNot: function(node, frame) {
        this.emit('!');
        this.compile(node.target, frame);
    },

    compileFloorDiv: function(node, frame) {
        this.emit('Math.floor(');
        this.compile(node.left, frame);
        this.emit(' / ');
        this.compile(node.right, frame);
        this.emit(')');
    },

    compilePow: function(node, frame) {
        this.emit('Math.pow(');
        this.compile(node.left, frame);
        this.emit(', ');
        this.compile(node.right, frame);
        this.emit(')');
    },

    compileNeg: function(node, frame) {
        this.emit('-');
        this.compile(node.target, frame);
    },

    compilePos: function(node, frame) {
        this.emit('+');
        this.compile(node.target, frame);
    },

    compileCompare: function(node, frame) {
        this.compile(node.expr, frame);

        for(var i=0; i<node.ops.length; i++) {
            var n = node.ops[i];
            this.emit(' ' + compareOps[n.type] + ' ');
            this.compile(n.expr, frame);
        }
    },

    compileLookupVal: function(node, frame) {
        this.emit('(');
        this._compileExpression(node.target, frame);
        this.emit(')');
        this.emit('[');
        this._compileExpression(node.val, frame);
        this.emit(']');
    },

    _emitCallArgs: function(args, frame, startChar, endChar) {
        this.emit(startChar);

        for(var j=0; j<args.length; j++) {
            if(j != 0) {
                this.emit(', ');
            }
            this.compile(args[j], frame);
        }
        this.emit(endChar);
    },

    _emitCallKwargs: function(kwargs, frame) {
        this.emit('{');

        for(var i=0; i<kwargs.length; i++) {
            var name = kwargs[i][0];
            var val = kwargs[i][1];
            this.emit(name.value);
            this.emit(': ');
            this.compile(val, frame);
        }
        this.emit('}');
    },

    _emitWrappedExpression: function(node, frame) {
        this.emit('(');
        this._compileExpression(node.name, frame);
        this.emit(')');
    },

    collectArgs: function(node, frame) {
        var args = [];
        var kwargs = [];
        for(var i=0; i<node.children.length; i++) {
            var arg = node.children[i];
            var name = arg.getKey();
            var val = arg.getValue();
            if(name) {
                kwargs.push([name, val]);
            } else {
                args.push(val);
            }
        }
        return [args, kwargs];
    },

    compileFunCall: function(node, frame) {
        var allArgs = this.collectArgs(node);
        var args = allArgs[0];
        var kwargs = allArgs[1];
        this._emitWrappedExpression(node, frame);
        this.emit('.isMacro ? ');
        this._emitWrappedExpression(node, frame);
        this.emit('(');
        this._emitCallArgs(args, frame, '[', ']');
        this.emit(', ');
        this._emitCallKwargs(kwargs, frame);
        this.emit(') : ');
        this._emitWrappedExpression(node, frame);
        this._emitCallArgs(args, frame, '(', ')');
    },

    compileFilter: function(node, frame) {
        var name = node.name;
        this.assertType(name, nodes.Symbol);

        this.emit('env.getFilter("' + name.value + '")');
        var args = this.collectArgs(node)[0];
        this._emitCallArgs(args, frame, '(', ')');
    },

    compileSet: function(node, frame) {
        var val = this.tmpid();

        this.emit('var ' + val + ' = ');
        this._compileExpression(node.value);
        this.emitLine(';');

        for(var i=0; i<node.targets.length; i++) {
            var t = node.targets[i];
            this.emitLine('context.setVariable("' + t.value + '", ' +
                          val + ');');
            if(t.value.charAt(0) != '_') {
                this.emitLine('context.addExport("' + t.value + '");');
            }
        }
    },

    compileIf: function(node, frame) {
        this.emit('if(');
        this._compileExpression(node.cond, frame);
        this.emitLine(') {');
        this.compile(node.body, frame);

        if(node.else_) {
            this.emitLine('}\nelse {');
            this.compile(node.else_, frame);
        }

        this.emitLine('}');
    },

    compileFor: function(node, frame) {
        var i = this.tmpid();
        var arr = this.tmpid();
        frame = frame.push();

        this.emitLine('frame = frame.push();');

        this.emit('var ' + arr + ' = ');
        this._compileExpression(node.arr, frame);
        this.emitLine(';');

        if(node.name instanceof nodes.Array) {
            // key/value iteration
            var key = node.name.children[0];
            var val = node.name.children[1];
            var k = this.tmpid();
            var v = this.tmpid();

            frame.set(key.value, k);
            frame.set(val.value, v);

            this.emitLine('var ' + i + ' = -1;');
            this.emitLine('for(var ' + k + ' in ' + arr + ') {');
            this.emitLine(i + '++;');
            this.emitLine('var ' + v + ' = ' + arr + '[' + k + '];');
            this.emitLine('frame.set("' + key.value + '", ' + k + ');');
            this.emitLine('frame.set("' + val.value + '", ' + v + ');');
            this.emitLine('frame.set("loop.index", ' + i + ' + 1);');
            this.emitLine('frame.set("loop.index0", ' + i + ');');
            this.emitLine('frame.set("loop.first", ' + i + ' === 0);');
        }
        else {
            var v = this.tmpid();

            frame.set(node.name.value, v);

            this.emitLine('for(var ' + i + '=0; ' + i + ' < ' + arr + '.length; ' +
                          i + '++) {');
            this.emitLine('var ' + v + ' = ' + arr + '[' + i + '];');
            this.emitLine('frame.set("' + node.name.value +
                          '", ' + v + ');');
            this.emitLine('frame.set("loop.index", ' + i + ' + 1);');
            this.emitLine('frame.set("loop.index0", ' + i + ');');
            this.emitLine('frame.set("loop.revindex", ' + arr + '.length - ' + i + ');');
            this.emitLine('frame.set("loop.revindex0", ' + arr + '.length - ' + i + ' - 1);');
            this.emitLine('frame.set("loop.first", ' + i + ' === 0);');
            this.emitLine('frame.set("loop.last", ' + i + ' === ' + arr + '.length - 1);');
            this.emitLine('frame.set("loop.length", ' + arr + '.length);');
        }

        this.compile(node.body, frame);
        this.emitLine('}');

        this.emitLine('frame = frame.pop();');
    },

    macroBody: function(node, frame) {
        frame = frame.push();
        this.emitLine('frame = frame.push();');
        var args = [];

        for(var i=0; i<node.children.length; i++) {
            var name = node.children[i].getKey().value
            args.push('l_' + name);
            frame.set(name, 'l_' + name);
        }
        this.emitLine('var macro = function(' + args.join(', ') + ') {');
        var oldBuffer = this.buffer;
        this.buffer = 'macroOutput';
        this.emitLine('var ' + this.buffer + '= "";');
        this.compile(node.body, frame)
        this.emitLine('return ' + this.buffer + ';');
        this.emitLine('};');
        this.buffer = oldBuffer;
        this.emitLine('frame = frame.pop();');
        return frame;
    },

    macroDef: function(node, frame) {
        var name = node.name.value;
        this.emit('runtime.wrapMacro(macro, "' + name + '", ' + '[');

        for(var i=0; i<node.children.length; i++) {
            var arg = node.children[i];
            var name = arg.getKey().value;
            var val = arg.getValue();
            this.emit('["' + name + '", ');
            val ? this.compile(val, frame) : this.emit('null');
            this.emit(']');

            if(i != node.children.length - 1) {
                this.emit(', ');
            }
        }
        this.emitLine('], false, false, false);');
    },

    compileMacro: function(node, frame) {
        var macroFrame = this.macroBody(node, frame);
        var name = node.name.value;
        this.emit('var l_' + name + ' = ');
        this.macroDef(node, macroFrame);
        frame.set(name, 'l_' + name);

        if(!this.isChild) {
            if(node.name.value.charAt(0) != '_') {
                this.emitLine('context.addExport("' + name + '");');
            }
            this.emitLine('context.setVariable("' + name + '", l_' + name + ');');
        }
    },

    compileImport: function(node, frame) {
        this.emit('var l_' + node.target + ' = env.getTemplate(');
        this.compile(node.template, frame);
        this.emitLine(').getModule();');
        frame.set(node.target, 'l_' + node.target);

        if(!this.isChild) {
            this.emitLine('context.setVariable("' + node.target + '", l_' + node.target + ');');
        }
    },

    compileFromImport: function(node, frame) {
        this.emit('var includedTemplate = env.getTemplate(');
        this.compile(node.template, frame);
        this.emitLine(').getModule();');

        for(var i=0; i<node.children.length; i++) {
            var name = node.children[i].getKey().value;
            var alias = node.children[i].getValue();
            if(alias) {
                alias = alias.value;
            } else {
                alias = name;
            }

            this.emitLine('if(includedTemplate.hasOwnProperty("' + name + '")) {');
            this.emitLine('var l_' + alias + ' = includedTemplate.' + name + ';');
            this.emitLine('} else {');
            // TODO: Add runtime errors
            this.emitLine('// Add runtime error here');
            this.emitLine('}');
            frame.set(alias, 'l_' + alias);

            if(!this.isChild) {
                this.emitLine('context.setVariable("' + alias + '", l_' + alias + ');');
            }
        }
    },

    compileBlock: function(node, frame) {
        this.emitLine(this.buffer + ' += context.getBlock("' +
                      node.name.value + '")(env, context, frame);');
    },

    compileExtends: function(node, frame) {
        if(this.isChild) {
            throw new Error('cannot extend multiple times');
        }

        this.emit('var parentTemplate = env.getTemplate(');
        this._compileExpression(node.template, frame);
        this.emitLine(', true);');

        var k = this.tmpid();

        this.emitLine('for(var ' + k + ' in parentTemplate.blocks) {');
        this.emitLine('context.addBlock(' + k +
                      ', parentTemplate.blocks[' + k + ']);');
        this.emitLine('}');

        this.isChild = true;
    },

    compileInclude: function(node, frame) {
        this.emit('var includeTemplate = env.getTemplate(');
        this._compileExpression(node.template, frame);
        this.emitLine(');');
        this.emitLine(this.buffer +
                      ' += includeTemplate.render(' +
                      'context.getVariables(), frame);');
    },

    compileTemplateData: function(node, frame) {
        this.compileLiteral(node, frame);
    },

    compileOutput: function(node, frame) {
        this.emit(this.buffer + ' += ');
        this._compileChildren(node, frame);
        this.emit(';\n');
    },

    compileRoot: function(node, frame) {
        if(frame) {
            throw new Error("root node can't have frame");
        }

        frame = new Frame();

        this.emitFuncBegin('root');
        this._compileChildren(node, frame);
        if(this.isChild) {
            this.emitLine('return ' +
                          'parentTemplate.rootRenderFunc(env, context, frame, runtime);');
        }
        this.emitFuncEnd(this.isChild);

        var blocks = node.findAll(nodes.Block);
        for(var i=0; i<blocks.length; i++) {
            var block = blocks[i];
            var name = block.name.value;

            this.emitFuncBegin('b_' + name);
            this.emitLine('var l_super = context.getSuper(env, ' +
                          '"' + name + '", ' +
                          'b_' + name + ', ' +
                          'runtime);');

            var tmpFrame = frame.push();
            frame.set('super', 'l_super');
            this.compile(block.body, tmpFrame);

            this.emitFuncEnd();
        }

        this.emitLine('return {');
        for(var i=0; i<blocks.length; i++) {
            var block = blocks[i];
            var name = 'b_' + block.name.value;
            this.emitLine(name + ': ' + name + ',');
        }
        this.emitLine('root: root\n};');
    },

    compile: function (node, frame) {
        var _compile = this["compile" + node.typename];
        if(_compile) {
            _compile.call(this, node, frame);
        }
        else {
            throw new Error("Cannot compile node: " + node.typename);
        }
    },

    getCode: function() {
        return this.codebuf.join("");
    }
});

// var fs = require("fs");
// var c = new Compiler();
// var src = "{{ test('hello') }}";

// var ns = parser.parse(src);
// nodes.printNodes(ns);
// c.compile(ns);

// var tmpl = c.getCode();

// console.log(tmpl);

module.exports = {
    compile: function(src) {
        var c = new Compiler();
        c.compile(parser.parse(src));
        return c.getCode();
    },

    Compiler: Compiler
};
