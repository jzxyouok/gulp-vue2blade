'use strict';
var compiler = require('./build');

var path = require('path');

var gutil = require('gulp-util');

var File = gutil.File;

var through = require('through2');
var objectAssign = require('object-assign');
var js2php = require('js2php');

function makeMap (
  str,
  expectsLowerCase
) {
  var map = Object.create(null);
  var list = str.split(',');
  for (var i = 0; i < list.length; i++) {
    map[list[i]] = true;
  }
  return expectsLowerCase
    ? function (val) { return map[val.toLowerCase()]; }
    : function (val) { return map[val]; }
}

var funRE = /[a-zA-Z]+[a-zA-Z0-9_]*\s*\(\s*([^\(\)]+)\s*\)/;
var isFunRE = /^\s*[a-zA-Z]+[a-zA-Z0-9_]*\s*\(\s*([^\(\)]+)\s*\)\s*$/;
var strRE = /^\s*(\$|true|false|NaN|null|undefined|\d+|(\'|\").+\1)$/;
var logicRE = /\s*(\!\={1,2}|\={2,3}|\>\=|\<\=|\>|\<|\&\&|\|\||\(|\))\s*/;
var aritRE = /\s*((\+{1,2}|\-{1,2}|\*|\/|\%)|(\+|\-|\*|\/|\%)?\=)\s*/;

function isFun(obj) {
  return !!isFunRE.test(obj);
}

var objRE = /\{([^\}]+)\}/;
var isObjRE = /^\s*\{[^\}]+\}\s*$/;

function isObj(obj) {
  return !!isObjRE.test(obj);
}

function toPHP(code, isIf) {
  return js2php(code)
  .replace(/^<\?php\n|\;\n$/gm, '')
  .replace(/\$\$route\-\>params\-\>/g, '$')
  .replace(/\$this\-\>\$parent\-\>/g, '$')
  .replace(/\$this\-\>\$root\-\>/g, '$')
  .replace(/\$this\-\>/g, '$')
  .replace(/Number\s*\(/g, "(");
}

function mackTemplate(vmast, tab) {

  tab = tab || '';

  var result = '';

  var beforeTag = '';
  var tagStart = '';
  var tagEnd = '';
  var afterTag = '';
  var attrs = '';
  var childrens = '';

  if(!vmast.tag && vmast.text) {
    return vmast.text.replace(/\{\{\s*([^\{]+)\s*\}\}/g, function(all, param) {
      if(param) {
        return '{{ ' + toPHP(param) + ' }}';
      }
    });
  }

  vmast.tag = vmast.tag.replace(/router\-link/, 'a');

  var tagStartNewLine = (tab && vmast.parent && vmast.parent.tag && !isInlineTag(vmast.parent.tag)) && !isSVG(vmast.parent.tag);
  var tagEndNewLine = !isInlineTag(vmast.tag) && !isSVG(vmast.tag)
                      && (vmast.children.length > 1 || (vmast.children.length == 1 && vmast.children[0].tag));

  //判断标签是否为html标签
  if(vmast.tag !== 'template' &&  (isHTMLTag(vmast.tag) || isSVG(vmast.tag))) {
    //获取html属性，结果 ' name="abc" value="abc"'\
    for(var name in vmast.attrsMap) {
      var value = vmast.attrsMap[name];

      if(/^(v\-bind)?\:/.test(name)) {
        name = name.replace(/^(v\-bind)?\:/, '');
        value = '{{ ' + toPHP(value) + ' }}';
      }

      if(vmast.tag === 'a') {
        if(name === 'to') {
          name = 'href';
        }
      }

      if(!/^data\-/.test(name) && (/^(\@|v\-on\:|v\-[^bind])/.test(name) || !isAttr(name) || isObj(value))) {
        continue;
      }

      attrs += ' ' + name + '="' + value + '"';
    }

    vmast.directives && vmast.directives.forEach(function(directive) {
      if(directive.name !== 'bind') {
        return;
      }
      var attr_objs = directive.value.match(/^\s*\{(.*)\}\s*$/);
      if(attr_objs && attr_objs.length > 1) {
        var strs = [];
        var strs_len = -1;
        var attr_objs_arr = attr_objs[1].replace(/(\'|\")(.+)\1/g, function(str) {
          strs.push(str.replace(/^(\'|\")(.+)\1$/, "$2"));
          strs_len++;
          return '\'<LQ_&%$|@>'+ strs_len +'</@|$%&_LQ>\'';
        }).split(/\s*\,\s*/);
        attr_objs_arr.forEach(function(attr) {
          var attr_i = attr.split(/\s*\:\s*/);
          var name = attr_i[0];
          var value = attr_i[1];
          var str_key = Number(value.replace(/^\'\<LQ\_\&\%\$\|\@\>(\d+)\<\/\@\|\$\%\&\_LQ\>\'$/, "$1"));
          var str_value = str_key >= 0 && strs[str_key];
          if(str_value) {
            value = str_value;
          } else {
            value = '{{ ' + toPHP(value) + ' }}';
          }
          attrs += ' ' + name + '="' + value + '"';
        });
      }
    });

    if(vmast.if || vmast.for || vmast.else || tagStartNewLine) {
      tagStart += "\n";
    }

    if(tagStartNewLine) {
      tagStart += tab;
    }

    tagStart += '<' + vmast.tag + attrs + '>';

    if(!isUnaryTag(vmast.tag)) {
      if(tagEndNewLine) {
        tagEnd += "\n" + tab;
      }
      tagEnd += '</' + vmast.tag + '>';
    }
  }

  vmast.children && vmast.children.forEach(function(children) {
    var new_tab = tab;
    if(vmast.tag !== 'template') {
      new_tab += '    ';
    }
    childrens += mackTemplate(children, new_tab);
  });

  if(vmast.if) {
    beforeTag += "\n" + tab + '@if ( ';
    beforeTag += toPHP(vmast.if, true);
    beforeTag += ' )';
  }

  if(vmast.elseif) {
    beforeTag += "\n" + tab + '@elseif ( ';
    beforeTag += toPHP(vmast.elseif, true);
    beforeTag += ' )';
  }

  if(vmast.else) {
    beforeTag += "\n" + tab + '@else';
  }

  if(vmast.for && vmast.alias) {
    var index = (vmast.iterator1 && toPHP(vmast.iterator1) + '=>') || '';
    beforeTag += "\n" + tab + '@foreach ( ' + toPHP(vmast.for) + ' as ' + index + toPHP(vmast.alias) + ' )';
    afterTag += "\n" + tab + '@endforeach';
  }

  if(vmast.if) {
    if(vmast.elseIfBlock) {
      afterTag += mackTemplate(vmast.elseIfBlock, tab);
    }
    if(vmast.elseBlock) {
      afterTag += mackTemplate(vmast.elseBlock, tab);
    }
    afterTag += "\n" + tab + '@endif';
  }

  result = beforeTag + tagStart + childrens + tagEnd + afterTag;

  return result;
}

function vue2blade(data, opts, appFile) {

    var template = data;
    var extendsStart = '';
    var extendsEnd = '';

    if(!appFile && !opts.include) {
      extendsStart += '@extends(\'' + (opts.basedir + opts.bladeLayoutName).replace(/\//g, '.') + '\')\n';
      extendsStart += '@section(\'' + opts.routerView + '\')\n';
      extendsEnd += '\n@endsection\n';
    }

    template = template
    .replace(/<style[\s\S]*?>([\s\S]*?)<\/style>/gm, '')
    .replace(/<script[\s\S]*?>([\s\S]*?)<\/script>/gm, '')
    .replace(/<!--([\s\S]*?)-->/gm, '')
    .replace(/^\s+|\s+$/g, '')
    .replace(/^<template[\s\S]*?>\s*|<\/template>$/g, '');

    var importsRE = /import\s+([^\s]+)\s+from\s+\'([^\s]+)\'/gm;
    var importRE = /import\s+([^\s]+)\s+from\s+\'([^\s]+)\'/;

    var imports = data.match(importsRE);
    imports && imports.forEach(function(import_i) {
        var import_arr = import_i.match(importRE);
        var name = import_arr[1].toLowerCase();
        var path = import_arr[2];
        path = path.replace(/^\.\//, '');
        if(opts.basedir) {
            path = opts.basedir + path;
        }
        path = path.replace(/\//g, '.').replace(/\.vue$/, '').toLowerCase();
        var this_includeRE = new RegExp('<' + name + '><\/' + name + '>', 'gmi');
        try{
            template = template.replace(this_includeRE, '@include(\'' + path + '\')');
        } catch(e) {}
    });

    template = template.replace(/<router\-view><\/router\-view>/g, '@yield(\'' + opts.routerView + '\')');

    var vm = compiler.compile(template);

    var vmast = vm.ast;

    return extendsStart + mackTemplate(vmast) + extendsEnd;
}

module.exports = function (opts) {

    if(typeof opts.nolayout === 'string') {
      opts.nolayout = [opts.nolayout];
    }

    opts = objectAssign({
        routerView: 'contents',
        basedir: '',
        layout: './src/App.vue',
        nolayout: ['./src/include'],
        bladeLayoutName: 'layouts.balde.php',
        index: './dist/index.html',
        appID: 'app'
    }, opts);

    opts.bladeLayoutName = opts.bladeLayoutName.replace('.balde.php', '');

    var indexSource;
    var files = [];

    return through.obj(function (file, enc, cb) {
        if (file.isNull()) {
            cb(null, file);
            return;
        }

        if (file.isStream()) {
            cb(null, file);
            return;
        }

        if (!file.contents.toString()) {
            cb(null, null);
            return;
        }

        if(file.path === path.join(__dirname, '../../' + opts.index)) {
          indexSource = file.contents.toString();
          //indexSource = indexSource.replace(/<script([^>]*)><\/script>/g, '');
          //indexSource = indexSource.replace(/<link([^>]*)>/g, '');
          //indexSource = indexSource.replace(/\s*<\/body>/gm, '  @include(\'' + opts.basedir.replace(/\//g, '.') + 'include.foot\')\n<\/body>');
          //indexSource = indexSource.replace(/<\/head>/, '  @include(\'' + opts.basedir.replace(/\//g, '.') + 'include.head\')\n<\/head>');
          cb(null, null);
          return;
        }

        var appFile = (file.path === path.join(__dirname, '../../' + opts.layout));

        var includeFile = false;

        opts.nolayout.forEach(function(nolayout) {
          var nolayoutdir = path.join(__dirname, '../../' + nolayout);
          if(file.path.replace(nolayoutdir, '') !== file.path) {
            includeFile = true;
          }
        })

        try {
            if(file.contents) {
                var res = vue2blade(file.contents.toString(), opts, appFile || includeFile);
                file.contents = new Buffer(res);
                file.path = gutil.replaceExtension(file.path.toLowerCase(), '.blade.php');
                if(appFile && indexSource) {
                  var reg = new RegExp('<(\\w+)(\\s+[\\s\\S]*)?id\\=\\"' + opts.appID + '\\">\\s*<\\/\\1>');
                  var res2 = indexSource.replace(reg, res);
                  file.contents = new Buffer(res2);
                  file.path = file.path.replace(path.basename(opts.layout).replace('.vue', '').toLowerCase(), opts.bladeLayoutName);
                }
            }
        } catch (err) {
            console.log(err);
        }

        cb(null, file);
    });
};

var isAttr = makeMap(
  'accept,accept-charset,accesskey,action,align,alt,async,autocomplete,' +
  'autofocus,autoplay,autosave,bgcolor,border,buffered,challenge,charset,' +
  'checked,cite,class,code,codebase,color,cols,colspan,content,http-equiv,' +
  'name,contenteditable,contextmenu,controls,coords,data,datetime,default,' +
  'defer,dir,dirname,disabled,download,draggable,dropzone,enctype,method,for,' +
  'form,formaction,headers,<th>,height,hidden,high,href,hreflang,http-equiv,' +
  'icon,id,ismap,itemprop,keytype,kind,label,lang,language,list,loop,low,' +
  'manifest,max,maxlength,media,method,GET,POST,min,multiple,email,file,' +
  'muted,name,novalidate,open,optimum,pattern,ping,placeholder,poster,' +
  'preload,radiogroup,readonly,rel,required,reversed,rows,rowspan,sandbox,' +
  'scope,scoped,seamless,selected,shape,size,type,text,password,sizes,span,' +
  'spellcheck,src,srcdoc,srclang,srcset,start,step,style,summary,tabindex,' +
  'target,title,type,usemap,value,width,wrap'
);

var isHTMLTag = makeMap(
  'html,body,base,head,link,meta,style,title,' +
  'address,article,aside,footer,header,h1,h2,h3,h4,h5,h6,hgroup,nav,section,' +
  'div,dd,dl,dt,figcaption,figure,hr,img,li,main,ol,p,pre,ul,' +
  'a,b,abbr,bdi,bdo,br,cite,code,data,dfn,em,i,kbd,mark,q,rp,rt,rtc,ruby,' +
  's,samp,small,span,strong,sub,sup,time,u,var,wbr,area,audio,map,track,video,' +
  'embed,object,param,source,canvas,script,noscript,del,ins,' +
  'caption,col,colgroup,table,thead,tbody,td,th,tr,' +
  'button,datalist,fieldset,form,input,label,legend,meter,optgroup,option,' +
  'output,progress,select,textarea,' +
  'details,dialog,menu,menuitem,summary,' +
  'content,element,shadow,template'
);

var isUnaryTag = makeMap(
  'area,base,br,col,embed,frame,hr,img,input,isindex,keygen,' +
  'link,meta,param,source,track,wbr',
  true
);

// Elements that you can, intentionally, leave open
// (and which close themselves)
var canBeLeftOpenTag = makeMap(
  'colgroup,dd,dt,li,options,p,td,tfoot,th,thead,tr,source',
  true
);

// HTML5 tags https://html.spec.whatwg.org/multipage/indices.html#elements-3
// Phrasing Content https://html.spec.whatwg.org/multipage/dom.html#phrasing-content
var isNonPhrasingTag = makeMap(
  'address,article,aside,base,blockquote,body,caption,col,colgroup,dd,' +
  'details,dialog,div,dl,dt,fieldset,figcaption,figure,footer,form,' +
  'h1,h2,h3,h4,h5,h6,head,header,hgroup,hr,html,legend,li,menuitem,meta,' +
  'optgroup,option,param,rp,rt,source,style,summary,tbody,td,tfoot,th,thead,' +
  'title,tr,track',
  true
);

var isInlineTag = makeMap(
  'a,span,strong,em,img,label,input,i,button',
  true
);

// this map is intentionally selective, only covering SVG elements that may
// contain child elements.
var isSVG = makeMap(
  'svg,animate,circle,clippath,cursor,defs,desc,ellipse,filter,font,' +
  'font-face,g,glyph,image,line,marker,mask,missing-glyph,path,pattern,' +
  'polygon,polyline,rect,switch,symbol,text,textpath,tspan,use,view',
  true
);

var isDirectives = makeMap(
  'v-text','v-html','v-if','v-show','v-else','v-for','v-on','v-bind','v-model','v-pre','v-cloak','v-once'
);
