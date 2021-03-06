var request = require("request-promise");
var cheerio = require('cheerio');
var Stream = require("stream");
var fs = require('fs');

var DataFile = './database.sqlite';

var Sequelize = require('sequelize');
var sequelize = new Sequelize('mainDB', null, null, {
    dialect: "sqlite",
    storage: DataFile,
});

sequelize
    .authenticate()
    .then(function (err) {
        console.log('Connection has been established successfully.');
    }, function (err) {
        console.log('Unable to connect to the database:', err);
    });




//  MODELS
var User = sequelize.define('User', {
    userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        _autoGenerated: true
    },
    // userId: Sequelize.INTEGER,
    nickName: Sequelize.STRING,
    user: Sequelize.STRING,
    location: Sequelize.STRING,
    website: Sequelize.STRING,
    status: Sequelize.STRING,
    desc: Sequelize.STRING,
    email: Sequelize.STRING,
    stars: Sequelize.INTEGER,
    followers: Sequelize.INTEGER,
    repos: Sequelize.INTEGER,
    organization: Sequelize.STRING,
    has_location: Sequelize.INTEGER,
    has_organization: Sequelize.INTEGER,
    fetched: Sequelize.INTEGER,
});




function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function parseLink(link) {
    var users = [];
    var hasMore = false;
    var nextLink = null;
    try {
        console.log('fetch', link)
        var results = await request.get(link);
        var $ = cheerio.load(results);
        var data = $('.follow-list-item');
        var totalCount = $('.tabnav-tabs').find('.Counter').text();

        var nextLink = $('.paginate-container').find('.btn').last();
        for (let index = 0; index < data.length; index++) {
            const element = data.eq(index);
            var nameBlock = element.find('.follow-list-name');
            var userMeta = {
                userId: nameBlock.find('a').attr('data-hovercard-url').replace('/hovercards?user_id=', ""),
                nickName: nameBlock.find('span').attr('title'),
                user: nameBlock.find('a').text()
            };

            if (element.find('.octicon-location').length) {
                userMeta.location = element.find('.octicon-location').next().text();
                userMeta.has_location = 1;
            }

            if (element.find('.octicon-organization').length) {
                userMeta.organization = element.find('.octicon-organization').next().text();
                userMeta.has_organization = 1;
            }
            users.push(userMeta);
        }

        if (nextLink && nextLink.attr('disabled') != "disabled") {
            hasMore = true;
            nextLink = nextLink.attr('href');
        }

        console.log('totalCount', totalCount)
        console.log(data.length, users);
    } catch (e) {
        console.log(e);
    }

    return {
        users: users,
        hasMore: hasMore,
        nextLink: nextLink
    }


}


function createReadStream(repo) {
    var fetchURL = 'https://github.com/' + repo + '/stargazers';
    var currenLink = fetchURL;
    var pageNumber = 0;
    var readStream = Stream.Readable({
        objectMode: true,
        read: function (size) {
            (async () => {
                await sleep(10 * 1000);
                console.log('page', pageNumber)
                try {
                    var results = await parseLink(currenLink);
                    if (results.hasMore) {
                        pageNumber++;
                        currenLink = results.nextLink;
                    } else {
                        return this.emit('end');
                    }
                    results.users.forEach((user) => {
                        this.push(user);
                    })
                } catch (e) {
                    console.log(e);
                }


                return this.read();
            })();
        }
    });

    return readStream;
}




function getUpdateStream() {
    var readStream = Stream.Readable({
        objectMode: true,
        read: function (size) {
            (async () => {
                try {
                    var results = await User.findAll({
                        where: {
                            fetched: 0
                        },
                        limit: 10
                    });

                    for (let index = 0; index < results.length; index++) {
                        const element = results[index];
                        this.push(element);
                    }
                } catch (e) {
                    console.log(e);
                }
            })();
        }
    });

    return readStream;
}



async function parseProfile(user) {
    var link = 'https://github.com/' + user;
    var userMeta = {};

    console.log('parseProfile', user);
    try {
        var results = await request.get(link);
        var $ = cheerio.load(results);
        var element = $('body');

        if (element.find('.octicon-location').length) {
            userMeta.location = element.find('.octicon-location').next().text();
            userMeta.has_location = 1;
        }

        if (element.find('.octicon-organization').length) {
            userMeta.organization = element.find('.octicon-organization').next().text();
            userMeta.has_organization = 1;
        }

        if (element.find('.octicon-link').length) {
            userMeta.website = element.find('.octicon-link').next().text();
        }

        if (element.find('.user-profile-bio').length) {
            userMeta.desc = element.find('.user-profile-bio').text();
        }


        if (element.find('.user-status-message-wrapper').length) {
            userMeta.status = element.find('.user-status-message-wrapper').text();
        }

        var links = element.find('.UnderlineNav-item');

        for (let index = 0; index < links.length; index++) {
            const link = links.eq(index);
            var linkText = link.text();
            var count = link.find('.Counter').text();
            var countNumber = parseInt(count.trim());
            if (isNaN(countNumber)) countNumber = 0;

            if (linkText.indexOf('Repositories') > -1) {
                userMeta.repos = countNumber;
            }

            if (linkText.indexOf('Stars') > -1) {
                userMeta.stars = countNumber;
            }

            if (linkText.indexOf('Followers') > -1) {
                userMeta.followers = countNumber;
            }
        }

        if (userMeta.status) {
            userMeta.status = userMeta.status.trim();
        }
    } catch (e) {
        console.log(e);
    }
    return userMeta;
}


async function startFetchNewWorker() {
    var repo = '996icu/996.ICU';
    var reader = createReadStream(repo);
    reader.pipe(Stream.Writable({
        objectMode: true,
        write: function (line, _, next) {
            (async () => {
                try {
                    line.fetched = 0;
                    await User.create(line);
                } catch (e) {
                    // console.log(e);
                }
                next();
            })();
        }
    }));
}

async function startFetchWorker() {
    var readStream = getUpdateStream();
    readStream.pipe(Stream.Writable({
        objectMode: true,
        write: function (userItem, _, next) {
            (async () => {
                await sleep(8 * 1000);
                try {
                    var defaA = {};
                    var userDetailMeta = await parseProfile(userItem.user);
                    if (Object.keys(userDetailMeta).length) {
                        Object.assign(defaA, userDetailMeta);
                        // update
                    }
                    defaA.fetched = 1;
                    await userItem.update(defaA);
                } catch (e) {
                    console.log(e);
                }
                console.log('done');
                next();
            })();
        }
    }));
}


(async () => {
    if (!fs.existsSync(DataFile)) await sequelize.sync({
        force: true
    });
    startFetchWorker();
    startFetchNewWorker();
})();
