import PropTypes from 'prop-types';
import React, {Component} from 'react';
import {connect} from 'react-redux';
import {Redirect} from 'react-router-dom';
import {showError} from 'universal/modules/toast/ducks/toastDuck';
import {setNextUrl} from 'universal/redux/authDuck';

const unauthorizedDefault = {
  title: 'Unauthorized',
  message: 'Hey! You’re not supposed to be there. Bringing you someplace safe.'
};

const unauthenticatedDefault = {
  title: 'Unauthenticated',
  message: 'Hey! You haven’t signed in yet. Taking you to the sign in page.'
};

const mapStateToProps = (state) => {
  const {sub: userId, rol: tokenRole} = state.auth.obj;
  return {
    userId,
    tokenRole
  };
};

export default (role, {
  /* optional named options: */
  silent = false,
  unauthorized = unauthorizedDefault,
  unauthenticated = unauthenticatedDefault
} = {}) => (ComposedComponent) => {
  @connect(mapStateToProps)
  class RequiredAuthAndRole extends Component {
    static propTypes = {
      dispatch: PropTypes.func.isRequired,
      history: PropTypes.object.isRequired,
      location: PropTypes.object.isRequired,
      tokenRole: PropTypes.string,
      userId: PropTypes.string.isRequired
    };

    state = {
      legit: true
    };

    componentWillMount() {
      this.handleAuthChange(this.props);
    }

    handleAuthChange(props) { // eslint-disable-line
      const {userId, tokenRole, dispatch, location: {pathname}} = props;

      if (userId) {
        if (role && role !== tokenRole) {
          this.setState({legit: false});
          if (!silent) {
            dispatch(showError(unauthorized));
          }
        }
      } else {
        // no legit authToken
        if (!silent) {
          // squak about it:
          dispatch(showError(unauthenticated));
        }
        dispatch(setNextUrl(pathname));
        this.setState({legit: false});
      }
    }

    render() {
      const {legit} = this.state;
      if (!legit) {
        return <Redirect to="/" />;
      }
      return <ComposedComponent {...this.props} />;
    }
  }

  return RequiredAuthAndRole;
};
