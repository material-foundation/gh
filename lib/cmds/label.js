/*
 Copyright 2016-present The Material Motion Authors. All Rights Reserved.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

'use strict';

// -- Requires -------------------------------------------------------------------------------------

var async = require('async'),
    base = require('../base'),
    fs = require('fs'),
    hooks = require('../hooks'),
    logger = require('../logger'),
    openUrl = require('open'),
    util = require('util'),
    config = base.getConfig();

// -- Constructor ----------------------------------------------------------------------------------

function Label(options) {
    this.options = options;

    if (!options.repo && !options.all) {
        logger.error('You must specify a Git repository with a GitHub remote to run this command');
    }
}

// -- Constants ------------------------------------------------------------------------------------

Label.DETAILS = {
    alias: 'la',
    description: 'Provides a set of util commands to work with Labels.',
    commands: [
        'list',
        'templatize'
    ],
    options: {
        'all': Boolean,
        'detailed': Boolean,
        'repo': String,
        'template': String,
        'user': String
    },
    shorthands: {
        'a': ['--all'],
        'd': ['--detailed'],
        'r': ['--repo'],
        't': ['--template'],
        'u': ['--user']
    },
    payload: function (payload, options) {
        if (payload[0] == 'list') {
            options.list = true;
        } else if (payload[0] == 'templatize') {
            options.templatize = true;
        }
    }
};

// -- Commands -------------------------------------------------------------------------------------

Label.prototype.run = function () {
    var instance = this,
        options = instance.options;

    instance.config = config;

    if (options.templatize) {
        if (options.template) {
            var templateData = fs.readFileSync(options.template, 'utf8');
            if (templateData) {
                options.templateJSON = JSON.parse(fs.readFileSync(options.template, 'utf8'));
            }
            
            var example = {
                'map': {
                    'from': 'to'
                },
                'labels': {
                    'name': 'color'
                }
            };
            
            if (!options.templateJSON
                     || !options.templateJSON.map || !options.templateJSON.labels) {
                logger.warn('Your template .json file must be a dictionary of the form:');
                logger.warn(util.inspect(example, false, null));
                return;
            }
        } else {
            logger.error('Must provide a template .json file.');
            return;
        }

        if (options.all) {
            logger.warn('Templating labels for ' + logger.colors.green(options.user));

            instance.templateAllRepositories(function (err) {
                if (err) {
                    logger.error('Can\'t import labels for ' + options.user + '.');
                    return;
                }
            });
        }
        else {
            logger.warn('Templating labels on ' + logger.colors.green(options.user +
                '/' + options.repo));

            instance.template(options.user, options.repo, function (err) {
                if (err) {
                    logger.error('Can\'t list labels on ' + options.user + '/' + options.repo);
                    return;
                }
            });
        }
    }

    if (options.list) {
        if (options.all) {
            logger.warn('Listing labels for ' + logger.colors.green(options.user));

            instance.listFromAllRepositories(function (err) {
                if (err) {
                    logger.error('Can\'t list labels for ' + options.user + '.');
                    return;
                }
            });
        }
        else {
            logger.warn('Listing labels on ' + logger.colors.green(options.user +
                '/' + options.repo));

            instance.list(options.user, options.repo, function (err) {
                if (err) {
                    logger.error('Can\'t list labels on ' + options.user + '/' + options.repo);
                    return;
                }
            });
        }
    }
};

Label.prototype.list = function (user, repo, opt_callback) {
    var instance = this,
        options = instance.options,
        operations = [],
        payload;

    payload = {
        repo: repo,
        user: user
    };

    operations.push(function (callback) {
        base.github.issues.getLabels(payload, callback);
    });

    async.series(operations, function (err, results) {
        var labels = [];

        if (err && !options.all) {
            logger.error(logger.getErrorMessage(err));
        }

        results.forEach(function (result) {
            if (result) {
                labels = labels.concat(result);
            }
        });

        labels.sort(function (a, b) {
            return a.name < b.name ? -1 : 1;
        });

        if (labels && labels.length > 0) {
            labels.forEach(function (label) {
                var parts = [label.name];

                if (options.detailed) {
                    parts.push(label.color);
                }

                logger.log(parts.join('\t'));
            });

            opt_callback && opt_callback(err);
        }
    });
};

Label.prototype.listFromAllRepositories = function (opt_callback) {
    var instance = this,
        options = instance.options,
        payload;

    payload = {
        type: 'all',
        user: options.user
    };

    base.github.repos.getAll(payload, function (err, repositories) {
        if (err) {
            opt_callback && opt_callback(err);
        }
        else {
            repositories.forEach(function (repository) {
                instance.list(repository.owner.login, repository.name, opt_callback);
            });
        }
    });
};

Label.prototype.template = function (user, repo, opt_callback) {
    var instance = this,
        options = instance.options,
        operations = [];

    base.github.issues.getLabels({
        repo: repo,
        user: user
    }, function(err, results) {
        var labels = {};
        results.forEach(function (result) {
            labels[result.name] = result;
        });

        base.github.issues.getForRepo({
            repo: repo,
            user: user
        }, function(err, issues) {

          // Step 1: Create and update existing labels.

          Object.keys(options.templateJSON.labels).forEach(function(label) {
              var color = options.templateJSON.labels[label];

              if (label in labels && labels[label].color == color) {
                  return; // No need to update/create
              }

              operations.push(function (callback) {
                  var payload = {
                      repo: repo,
                      user: user,
                      name: util._extend(label),
                      color: util._extend(color)
                  };
                  if (label in labels || label.toLowerCase() in labels) {
                      base.github.issues.updateLabel(payload, callback);
                  } else {
                      base.github.issues.createLabel(payload, callback);
                  }
              });
          });

          // Step 2: Delete labels with no mapping.

          Object.keys(options.templateJSON.map).forEach(function(from) {
              var to = options.templateJSON.map[from];
              if ((from in labels) && !to) {
                  var payload = {
                      repo: repo,
                      user: user,
                      name: util._extend(from)
                  };
                  operations.push(function (callback) {
                      base.github.issues.deleteLabel(payload, callback);
                  });
              }
          });
        
          // TODO: Enumerate all issues with mapped labels and rename them.

          // Step 3: Delete all mapped labels
          // TODO: This should be a rename operation.

          Object.keys(options.templateJSON.map).forEach(function(from) {
              var to = options.templateJSON.map[from];
              // Is a mapped label?
              if ((from in labels) && to) {
                
                // For every issue...
                issues.forEach(function(issue) {
                  var issue_labels = {};
                  issue.labels.forEach(function (result) {
                    issue_labels[result.name] = result;
                  });
                  // If the label exists but hasn't been mapped...
                  if ((from in issue_labels) && !(to in issue_labels)) {
                    var payload = {
                      repo: repo,
                      user: user,
                      number: issue.number,
                      body: [
                        to
                      ]
                    };
                    operations.push(function (callback) {
                      base.github.issues.addLabels(payload, callback);
                    });
                  }
                })
              }
          });

          // Delete all of the renamed labels.
          Object.keys(options.templateJSON.map).forEach(function(from) {
              var to = options.templateJSON.map[from];
              if ((from in labels) && to) {
                var payload = {
                    repo: repo,
                    user: user,
                    name: util._extend(from)
                };
                operations.push(function (callback) {
                    base.github.issues.deleteLabel(payload, callback);
                });
              }
          });

          async.series(operations, function (err, results) {
              if (err) {
                  logger.error(logger.getErrorMessage(err));
              }
              opt_callback && opt_callback(err);
          });
        });
    });
};

Label.prototype.templateAllRepositories = function (opt_callback) {
    var instance = this,
        options = instance.options,
        payload;

    payload = {
        type: 'all',
        org: options.user
    };

    base.github.repos.getForOrg(payload, function (err, repositories) {
        if (err) {
            opt_callback && opt_callback(err);
        }
        else {
            repositories.forEach(function (repository) {
                instance.template(repository.owner.login, repository.name, opt_callback);
            });
        }
    });
};

exports.Impl = Label;
