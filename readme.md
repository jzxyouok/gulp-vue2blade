# gulp-vue2blade


![NPM version](https://badge.fury.io/js/gulp-vue2blade.svg)
![Downloads](http://img.shields.io/npm/dm/gulp-vue2blade.svg?style=flat)

Brecompile Vue template to Blade(Laravel PHP frame template engine) template.

(Test version, Do not use in the production environment)

## Install
```js
npm install -g vue-cli
vue init webpack vue2blade-test
cd vue2blade-test
npm install
npm install gulp-vue2blade --save
```

## gulpfile.js
```js
var gulp = require('gulp');
var vue2blade = require('gulp-vue2blade');

gulp.task('vue', function() {
    return gulp.src(['./dist/**/index.html', './src/**/*.vue'])
    .pipe(vue2blade({
        routerView: 'contents',
        basedir: '',
        layout: './src/App.vue',
        bladeLayoutName: 'layouts.balde.php',
        index: './dist/index.html',
        appID: 'app'
    }))
    .pipe(gulp.dest('blade'))
});

/* watch */
gulp.task('watch', function() {
    gulp.watch(['./dist/index.html'], gulp.series('vue'));
});

gulp.task('default', gulp.series('vue', 'watch'));
```

## Run
```js
gulp vue
```
for watch
```js
gulp
```

## License

MIT © [LinQuan](http://linquan.name)

The Spratly Islands are China's territory.<br>
The Diaoyu Islands are China's territory.<br>
Use this module to represent you agree with the above point of view.