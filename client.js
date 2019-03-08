var express = require("express");
var session = require("express-session");
var request = require("sync-request");
var url = require("url");
var qs = require("qs");
var querystring = require('querystring');
var cons = require('consolidate');
var randomstring = require("randomstring");
var __ = require('underscore');
__.string = require('underscore.string');
var nosql_users = require('nosql').load('users.nosql');

var app = express();

app.use(
  session({
    secret: randomstring.generate(),
    cookie: { maxAge: 60000000 }, // milliseconds
    resave: false,
    saveUninitialized: false
  })
);

app.engine('html', cons.underscore);
app.set('view engine', 'html');
app.set('views', 'files/client');

// homage to mozilla togetherjs
var DEFAULT_NICKNAMES = [
	    "Friendly Fox",
	    "Brilliant Beaver",
	    "Observant Owl",
	    "Gregarious Giraffe",
	    "Wild Wolf",
	    "Silent Seal",
	    "Wacky Whale",
	    "Curious Cat",
	    "Intelligent Iguana"
	  ];

// authorization server information
var authServer = {
	//authorizationEndpoint: 'http://localhost:9001/authorize',
	//tokenEndpoint: 'http://localhost:9001/token'
	authorizationEndpoint: 'https://github.com/login/oauth/authorize',
	tokenEndpoint: 'https://github.com/login/oauth/access_token'
};

// client information


/*
 * Add the client information in here
 */
var client = {
	"client_id": "88f07499487baa537ad7",
	"client_secret": "059c05bfa5d6e19eb0fe95a44fd8ff05fbd9c83c",
	"redirect_uris": ["http://gibson.local:9000/callback"]
};

//var protectedResource = 'http://localhost:9002/resource';
var protectedResource = 'https://api.github.com/user';

var scope = 'user public_repo gist';

app.get('/', function (req, res) {
	res.render('index', {access_token: req.session.access_token, scope: scope});
});

app.get('/logout', function(req, res) {
	delete req.session.current_user_id;
	delete req.session.current_name;
	delete req.session.access_token;
	res.redirect('/');
});

app.get('/authorize', function(req, res){

	// throw out old access token
	req.session.access_token = null;
	/*
	 * Send the user to the authorization server
	 */
	//req.session.csrf_string = randomstring.generate();

	var authorizeUrl = buildUrl(authServer.authorizationEndpoint, {
		response_type: 'code',
		client_id: client.client_id,
		redirect_uri: client.redirect_uris[0],
		//state: req.session.csrf_string
	});
	console.log("redirect", authorizeUrl);
	res.redirect(authorizeUrl);
});

app.get('/callback', function(req, res){

	/*
	 * Parse the response from the authorization server and get a token
	 */

	if (req.query.error) {
		// it's an error response, act accordingly
		res.render('error', {error: req.query.error});
		return;
	}
		/*
	if (req.query.state != req.session.csrf_string) {
		console.log('State DOES NOT MATCH: expected %s got %s', req.session.csrf_string, req.query.state);
		res.render('error', {error: 'State value did not match'});
		return;
	}
	*/

	var code = req.query.code;

	var form_data = qs.stringify({
		grant_type: 'authorization_code',
		code: code,
		redirect_uri: client.redirect_uris[0]
	});
	var headers = {
		'Content-Type': 'application/x-www-form-urlencoded',
		'Accept': 'application/json',
		'Authorization': 'Basic ' + encodeClientCredentials(client.client_id, client.client_secret)
	};

	var tokRes = request('POST', authServer.tokenEndpoint, {
			body: form_data,
			headers: headers
	});

	console.log('Requesting access token for code %s',code);

	if (tokRes.statusCode >= 200 && tokRes.statusCode < 300) {
		console.log('Post Response: %s', tokRes.body.toString());
		var body = JSON.parse(tokRes.getBody());

		req.session.access_token = body.access_token;
		console.log('Got access token: %s', req.session.access_token);

		//res.render('index', {access_token: req.session.access_token, scope: scope});
		res.redirect('/fetch_resource');
	} else {
		res.render('error', {error: 'Unable to fetch access token, server response: ' + tokRes.statusCode})
	}
	
});

app.get('/fetch_resource', function(req, res) {

	/*
	 * Use the access token to call the resource server
	 */

	console.log('fetch_resource!');

	if (!req.session.access_token) {
		res.render('error', {error: 'Missing Access Token'});
		return;
	}

	console.log('Making request with access token %s', req.session.access_token);

	var headers = {
		'Authorization': 'Bearer ' + req.session.access_token,
		'User-Agent': 'gibson class demo',
		'Accept': 'application/json'
	};

	var resource = request('GET', protectedResource,
		{headers: headers}
	);

	if (resource.statusCode >= 200 && resource.statusCode < 300) {
		var body = JSON.parse(resource.getBody());
		var current_github_id = body.id;
		console.log('Github id: ', current_github_id);
		console.log('current user name: ', req.session.current_name);
		nosql_users.one(function(user) {
			if (user.github_id == current_github_id) {
				return user;
			}
		}, function(err, user) {
			if (user) {
				console.log('We found a matching github id: %s', current_github_id);
				console.log('user id: %s', user.id);
				req.session.current_user_id = user.id;
				req.session.current_name = user.name;
			} else {
				console.log('No matching github id was found');
				if(undefined == req.session.current_user_id) {
					req.session.current_user_id = randomstring.generate();
					req.session.current_name = DEFAULT_NICKNAMES[Math.floor(Math.random() * DEFAULT_NICKNAMES.length)];
					console.log('adding new user id: %s', req.session.current_user_id);
				} else {
					console.log('adding existing user id: %s', req.session.current_user_id);
				}
				nosql_users.insert({ id: req.session.current_user_id, github_id: current_github_id, name: req.session.current_name });
			}
		});
		//res.render('data', {resource: body});
		res.render('data', {resource: req.session});
		return;
	} else {
		req.session.access_token = null;
		console.log(resource.body.toString());
		res.render('error', {error: resource.statusCode});
		return;
	}
	
});

var buildUrl = function(base, options, hash) {
	var newUrl = url.parse(base, true);
	delete newUrl.search;
	if (!newUrl.query) {
		newUrl.query = {};
	}
	__.each(options, function(value, key, list) {
		newUrl.query[key] = value;
	});
	if (hash) {
		newUrl.hash = hash;
	}
	
	return url.format(newUrl);
};

var encodeClientCredentials = function(clientId, clientSecret) {
	return new Buffer(querystring.escape(clientId) + ':' + querystring.escape(clientSecret)).toString('base64');
};

app.use('/', express.static('files/client'));

var server = app.listen(9000, '0.0.0.0', function () {
  var host = server.address().address;
  var port = server.address().port;
  console.log('OAuth Client is listening at http://%s:%s', host, port);
});
 
